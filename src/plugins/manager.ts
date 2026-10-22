import { createElement } from "react";
import { version as APP_VERSION } from "../../package.json";
import { plugins as pluginsIpc, type PluginsState } from "../platform/ipc";
import { isIOSApp } from "../platform/capabilities";
import { isMacPlatform, isWindowsPlatform } from "../platform/os";
import { registerCommand, runCommand } from "../app/commands";
import { registerSidebarTab } from "../app/sidebar-tabs";
import { registerEditorMenuItems } from "../editor/editor-menu";
import { showConfirm, showMessage } from "../ui/app-dialog";
import { basename } from "../utils/path";
import type { Strings } from "../i18n/strings";
import { PluginHost } from "./broker";
import { type PluginOrigin } from "./files";
import {
  engineSatisfied,
  localize,
  matchesFilename,
  parseManifest,
  type Permission,
  type PluginManifest,
} from "./manifest";
import { permissionLabel } from "./permissions";
import { PluginTabIcon, PluginWebviewPanel } from "./PluginWebview";
import {
  removeWebview,
  webview,
  webviewState,
  type WebviewRecord,
} from "./webviews";
import { canRun, canSwitch, nextStatus, type PluginStatus } from "./lifecycle";

/**
 * Every plugin installed - from the catalog (catalog.ts) or a file - and
 * a developer's loaded folder, with its switch, its grants and what it
 * adds while on
 * (docs/design/plugins.md §5-6).
 *
 * A plugin's contributions (commands, sidebar tabs, menu items, file
 * types) are registered as soon as it is on, from its manifest alone; its
 * code starts the first time one of them is used, or at startup if it
 * asks (`onStartupFinished`).
 */

export type { PluginStatus } from "./lifecycle";

export interface PluginRecord {
  id: string;
  origin: PluginOrigin;
  manifest: PluginManifest | null;
  status: PluginStatus;
  granted: Permission[];
  problem?: string;
  /** Where its files are, for one on disk. */
  dir?: string;
  /** Installed from the catalog as CatVinci's own (Rust decides it,
   *  plugins/catalog.rs): Settings marks it Official. */
  official: boolean;
}

export interface PluginsSnapshot {
  loaded: boolean;
  allOn: boolean;
  records: PluginRecord[];
}

let snapshot: PluginsSnapshot = { loaded: false, allOn: true, records: [] };
const listeners = new Set<() => void>();
const hosts = new Map<string, PluginHost>();
const contributions = new Map<string, (() => void)[]>();
const settingsCache = new Map<string, Record<string, unknown>>();

/** What the window tells the manager about itself (usePluginManager). */
let windowInfo: {
  strings: () => Strings;
  language: () => string;
  dark: () => boolean;
} = {
  strings: () => {
    throw new Error("Plugins are not set up yet.");
  },
  language: () => "en",
  dark: () => false,
};

export function configurePlugins(info: typeof windowInfo): void {
  windowInfo = info;
}

function publish(next: Partial<PluginsSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function update(id: string, change: Partial<PluginRecord>) {
  publish({
    records: snapshot.records.map((r) =>
      r.id === id ? { ...r, ...change } : r,
    ),
  });
}

export function subscribePlugins(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pluginsSnapshot(): PluginsSnapshot {
  return snapshot;
}

export function pluginRecord(id: string): PluginRecord | undefined {
  return snapshot.records.find((r) => r.id === id);
}

/** A plugin's name in the UI language. */
export function pluginName(
  record: Pick<PluginRecord, "id" | "manifest">,
): string {
  return record.manifest
    ? localize(record.manifest, record.manifest.name, windowInfo.language())
    : record.id;
}

export function pluginText(
  record: Pick<PluginRecord, "manifest">,
  value: string,
): string {
  return record.manifest
    ? localize(record.manifest, value, windowInfo.language())
    : value;
}

function platform(): string {
  if (isIOSApp) return "ios";
  if (isMacPlatform()) return "macos";
  if (isWindowsPlatform()) return "windows";
  return "linux";
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function makeRecord(
  id: string,
  origin: PluginOrigin,
  text: string,
  state: PluginsState,
  dir?: string,
): PluginRecord {
  const entry = state.plugins[id];
  const granted = (entry?.granted ?? []) as Permission[];
  try {
    const manifest = parseManifest(text);
    if (manifest.id !== id)
      throw new Error(`id "${manifest.id}" is not its folder's, "${id}".`);
    const compatible = engineSatisfied(manifest.engine, APP_VERSION);
    return {
      id,
      origin,
      manifest,
      dir,
      granted,
      official: !!entry?.official,
      status: nextStatus(null, {
        type: "read",
        manifest: compatible ? "ok" : "incompatible",
        enabled: !!entry?.enabled,
      }),
      problem: compatible ? undefined : manifest.engine,
    };
  } catch (err) {
    return {
      id,
      origin,
      manifest: null,
      dir,
      granted,
      official: !!entry?.official,
      status: nextStatus(null, {
        type: "read",
        manifest: "broken",
        enabled: false,
      }),
      problem: String((err as Error)?.message ?? err),
    };
  }
}

let loading: Promise<void> | null = null;

/** Reads every plugin and turns on those that are on. Once per window;
 *  `reload` reads them again (after an install). */
export function loadPlugins(reload = false): Promise<void> {
  // Desktop only for now (settings-pages.tsx says why).
  if (isIOSApp) return Promise.resolve();
  if (loading && !reload) return loading;
  loading = (async () => {
    const [state, installed] = await Promise.all([
      pluginsIpc
        .state()
        .catch(() => ({ allOn: true, plugins: {} }) as PluginsState),
      pluginsIpc.installed().catch(() => []),
    ]);
    const records: PluginRecord[] = [];
    for (const p of installed)
      records.push(
        makeRecord(p.id, p.dev ? "dev" : "installed", p.manifest, state, p.dir),
      );
    records.sort((a, b) => pluginName(a).localeCompare(pluginName(b)));
    for (const id of [...contributions.keys()]) withdraw(id);
    publish({ loaded: true, allOn: state.allOn, records });
    for (const record of records)
      if (canRun(record.status, state.allOn)) apply(record);
  })();
  return loading;
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function host(record: PluginRecord): PluginHost {
  let running = hosts.get(record.id);
  if (!running && record.manifest) {
    running = new PluginHost(
      {
        manifest: record.manifest,
        origin: record.origin,
        granted: record.granted,
      },
      {
        strings: () => windowInfo.strings(),
        language: () => windowInfo.language(),
        dark: () => windowInfo.dark(),
        appVersion: APP_VERSION,
        platform: platform(),
        // What the user set is read from the plugin's storage the first
        // time: a plugin asks for its settings as it starts, long before
        // anyone opens its page in Settings.
        setting: async (id, key) => {
          await loadPluginSettings(id);
          return pluginSetting(id, key);
        },
        runCommand: async (command, args) => {
          const owner = snapshot.records.find(
            (r) => r.status === "on" && command.startsWith(`${r.id}.`),
          );
          if (owner) return runPluginCommand(owner.id, command, args);
          if (!runCommand(command, args))
            throw new Error(`No command ${command}.`);
          return null;
        },
        addCommand: (id, command) => {
          if (dynamicCommands.has(command)) return;
          dynamicCommands.set(
            command,
            registerCommand({
              id: command,
              title: () => command,
              run: () => void runPluginCommand(id, command, []),
            }),
          );
          contributions.get(id)?.push(() => removeDynamicCommand(command));
        },
        removeCommand: removeDynamicCommand,
        failed: pluginFailed,
      },
    );
    hosts.set(record.id, running);
  }
  if (!running) throw new Error(`${record.id} can't run.`);
  return running;
}

/** Commands a plugin's code registered beyond its manifest's. */
const dynamicCommands = new Map<string, () => void>();

function removeDynamicCommand(command: string) {
  dynamicCommands.get(command)?.();
  dynamicCommands.delete(command);
}

function stopHost(id: string) {
  hosts.get(id)?.stop();
  hosts.delete(id);
}

async function pluginFailed(id: string, reason: string) {
  const record = pluginRecord(id);
  if (!record || record.status !== "on") return;
  stopHost(id);
  withdraw(id);
  update(id, {
    status: nextStatus(record.status, { type: "fail" }),
    problem: reason,
  });
  await pluginsIpc.set(id, false, record.granted).catch(() => {});
  const t = windowInfo.strings();
  void showMessage(
    t.pluginFailedNotice
      .replace("{name}", pluginName(record))
      .replace("{reason}", reason),
    {
      title: t.pluginsTitle,
      tone: "warning",
    },
  );
}

/** Runs one of a plugin's commands in its code, starting it first. */
export async function runPluginCommand(
  id: string,
  command: string,
  args: unknown[],
): Promise<unknown> {
  const record = pluginRecord(id);
  if (!record || !canRun(record.status, snapshot.allOn))
    throw new Error(`${id} is turned off.`);
  return host(record).request("$executeCommand", { command, args });
}

/** Asks the plugin to fill a webview (PluginWebview.tsx): a sidebar tab's
 *  or a view's panel, a custom editor, a settings page. */
export async function resolveWebview(
  record: WebviewRecord,
  target: { view?: string; viewType?: string; state?: unknown },
): Promise<void> {
  const plugin = pluginRecord(record.plugin);
  if (!plugin || plugin.status !== "on")
    throw new Error(`${record.plugin} is turned off.`);
  const running = host(plugin);
  if (record.kind === "editor")
    await running.request("$resolveCustomEditor", {
      viewType: target.viewType,
      webview: record.id,
      path: record.resource,
    });
  else if (record.kind === "settings")
    await running.request("$resolveSettingsPage", { webview: record.id });
  else
    await running.request("$resolveWebviewView", {
      view: target.view,
      webview: record.id,
      state: webviewState(record.key) ?? target.state ?? null,
    });
}

/** A webview's frame message, for its plugin's code. */
export function webviewMessage(id: string, message: unknown): void {
  const record = webview(id);
  const plugin = record && pluginRecord(record.plugin);
  if (!record || !plugin || plugin.status !== "on") return;
  void host(plugin)
    .request("$webviewMessage", { webview: id, message })
    .catch(() => {});
}

/** A webview closed: forgotten here and by its plugin. */
export function disposeWebview(id: string): void {
  const record = removeWebview(id);
  if (!record) return;
  hosts.get(record.plugin)?.notify("$webviewDisposed", { webview: id });
}

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------

/** Registers what an on plugin adds, from its manifest. */
function apply(record: PluginRecord) {
  const manifest = record.manifest;
  if (!manifest || contributions.has(record.id)) return;
  const id = record.id;
  const text = (value: string) =>
    localize(manifest, value, windowInfo.language());
  const undo: (() => void)[] = [];
  const { commands, keybindings, menus, sidebarTabs } = manifest.contributes;
  for (const command of commands)
    undo.push(
      registerCommand({
        id: command.command,
        title: () => text(command.title),
        shortcut: keybindings.find((k) => k.command === command.command)?.key,
        run: (...args) =>
          void runPluginCommand(id, command.command, args).catch((err) =>
            showMessage(String((err as Error)?.message ?? err), {
              title: text(manifest.name),
              tone: "error",
            }),
          ),
      }),
    );
  const contextItems = menus["editor/context"] ?? [];
  if (contextItems.length)
    undo.push(
      registerEditorMenuItems(({ selectedText }) =>
        contextItems
          .filter((item) => item.when !== "editorHasSelection" || selectedText)
          .map((item) => {
            const command = commands.find((c) => c.command === item.command);
            return {
              label: text(command?.title ?? item.command),
              onSelect: () => runCommand(item.command),
            };
          }),
      ),
    );
  for (const tab of sidebarTabs)
    undo.push(
      registerSidebarTab({
        id: tab.id,
        label: () => text(tab.title),
        Icon: () =>
          createElement(PluginTabIcon, {
            plugin: id,
            origin: record.origin,
            icon: tab.icon,
          }),
        Panel: () =>
          createElement(PluginWebviewPanel, {
            plugin: id,
            view: tab.id,
            kind: "sidebar",
          }),
      }),
    );
  contributions.set(id, undo);
  if (
    manifest.activationEvents.includes("onStartupFinished") ||
    manifest.activationEvents.includes("*")
  )
    void host(record)
      .start()
      .catch(() => {});
}

/** Takes back what a plugin added. */
function withdraw(id: string) {
  for (const undo of contributions.get(id) ?? []) undo();
  contributions.delete(id);
}

/** The plugin that opens `path` in a tab of its own, if one is on:
 *  the first whose custom editor matches with priority "default". */
export function customEditorFor(
  path: string,
): { plugin: string; viewType: string; title: string } | null {
  if (!snapshot.allOn) return null;
  const name = basename(path);
  for (const record of snapshot.records) {
    if (record.status !== "on" || !record.manifest) continue;
    for (const editor of record.manifest.contributes.customEditors)
      if (
        editor.priority === "default" &&
        editor.filenamePatterns.some((p) => matchesFilename(p, name))
      )
        return { plugin: record.id, viewType: editor.viewType, title: name };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** A plugin's setting: what the user set, or its manifest's default. */
export function pluginSetting(id: string, key: string): unknown {
  const stored = settingsCache.get(id)?.[key];
  if (stored !== undefined) return stored;
  return (
    pluginRecord(id)?.manifest?.contributes.settings.find((s) => s.key === key)
      ?.default ?? null
  );
}

/** Reads a plugin's settings from its storage (once). */
export async function loadPluginSettings(id: string): Promise<void> {
  if (settingsCache.has(id)) return;
  const stored = await pluginsIpc
    .storageGet(id)
    .catch(() => ({}) as Record<string, unknown>);
  const values = stored.$settings;
  settingsCache.set(
    id,
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {},
  );
  update(id, {});
}

export async function setPluginSetting(
  id: string,
  key: string,
  value: unknown,
): Promise<void> {
  const values = { ...(settingsCache.get(id) ?? {}), [key]: value };
  settingsCache.set(id, values);
  update(id, {});
  await pluginsIpc.storageSet(id, "$settings", values);
  hosts.get(id)?.event("settings", { key, value });
}

// ---------------------------------------------------------------------------
// Switching on and off, installing
// ---------------------------------------------------------------------------

/** Asks the user for what the plugin asks that it hasn't been granted;
 *  the full list when granted, null when refused. */
async function askPermissions(
  record: PluginRecord,
): Promise<Permission[] | null> {
  const wanted = record.manifest?.permissions ?? [];
  const missing = wanted.filter((p) => !record.granted.includes(p));
  if (!missing.length) return wanted;
  const t = windowInfo.strings();
  const list = missing.map((p) => `• ${permissionLabel(p, t)}`).join("\n");
  const ok = await showConfirm(
    `${t.pluginPermissionsAsk.replace("{name}", pluginName(record))}\n\n${list}`,
    {
      title: t.pluginsTitle,
      okLabel: t.pluginAllow,
      cancelLabel: t.pluginCancel,
    },
  );
  return ok ? wanted : null;
}

/** Settings' switch for one plugin. Turning it on asks for its
 *  permissions first; refused, it stays off. */
export async function setPluginEnabled(id: string, on: boolean): Promise<void> {
  const record = pluginRecord(id);
  if (!record || !record.manifest) return;
  if (!canSwitch(record.status)) return;
  if (!on) {
    stopHost(id);
    withdraw(id);
    await pluginsIpc.set(id, false, record.granted);
    update(id, {
      status: nextStatus(record.status, { type: "disable" }),
      problem: undefined,
    });
    return;
  }
  const granted = await askPermissions(record);
  if (!granted) return;
  await pluginsIpc.set(id, true, granted);
  const next = {
    ...record,
    granted,
    status: nextStatus(record.status, { type: "enable" }),
    problem: undefined,
  };
  update(id, next);
  if (canRun(next.status, snapshot.allOn)) apply(next);
}

/** Takes back one permission; the plugin restarts without it. */
export async function revokePermission(
  id: string,
  permission: Permission,
): Promise<void> {
  const record = pluginRecord(id);
  if (!record) return;
  const granted = record.granted.filter((p) => p !== permission);
  stopHost(id);
  withdraw(id);
  // Without a permission it asks for, it can't run: off until granted.
  await pluginsIpc.set(id, false, granted);
  update(id, {
    granted,
    status: nextStatus(record.status, { type: "revoke" }),
  });
}

/** Settings › Extensions › Plugins › Plugins: every plugin at once. */
export async function setAllPlugins(on: boolean): Promise<void> {
  await pluginsIpc.setAll(on);
  if (!on) for (const id of [...hosts.keys()]) stopHost(id);
  if (!on) for (const id of [...contributions.keys()]) withdraw(id);
  publish({ allOn: on });
  for (const record of snapshot.records)
    if (canRun(record.status, on)) apply(record);
}

/** A developer's folder changed: its code and manifest read again. */
export async function reloadPlugin(id: string): Promise<void> {
  stopHost(id);
  withdraw(id);
  await loadPlugins(true);
}

export async function installPlugin(path: string): Promise<string> {
  const installed = await pluginsIpc.install(path);
  stopHost(installed.id);
  await loadPlugins(true);
  return installed.id;
}

export async function loadDevPlugin(path: string): Promise<string> {
  const loaded = await pluginsIpc.loadDev(path);
  stopHost(loaded.id);
  await loadPlugins(true);
  return loaded.id;
}

export async function uninstallPlugin(id: string): Promise<void> {
  stopHost(id);
  withdraw(id);
  settingsCache.delete(id);
  await pluginsIpc.uninstall(id);
  await loadPlugins(true);
}

/** The commands the plugins that are on put in the Plugins menu
 *  (contributes.menus["app/plugins"]), in the plugins' order. */
export function pluginMenuEntries(
  from: PluginsSnapshot = snapshot,
  menu: "app/plugins" | "app/tray" = "app/plugins",
): { command: string; label: string }[] {
  if (!from.allOn) return [];
  return from.records.flatMap((record) => {
    const manifest = record.manifest;
    if (record.status !== "on" || !manifest) return [];
    return (manifest.contributes.menus[menu] ?? []).map((item) => {
      const command = manifest.contributes.commands.find(
        (c) => c.command === item.command,
      );
      return {
        command: item.command,
        label: localize(
          manifest,
          command?.title ?? item.command,
          windowInfo.language(),
        ),
      };
    });
  });
}
