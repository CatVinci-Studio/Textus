// What plugins add to the editor registers before any editor is made.
import "./contributions/editor-extensions";
import { logPluginError } from "./store/plugin-log";
import {
  forgetPluginSettings,
  loadProjectPluginSettings,
  pluginValue,
  setPluginValue,
  type SettingScope,
} from "./store/plugin-settings";
import { version as APP_VERSION } from "../../package.json";
import { plugins as pluginsIpc, type PluginsState } from "../platform/ipc";
import type { PluginFile } from "../platform/ipc";
import { isIOSApp } from "../platform/capabilities";
import { isMacPlatform, isWindowsPlatform } from "../platform/os";
import { registerCommand, runCommand } from "../app/commands";
import { pickWithCommands } from "../app/command-palette-entry";
import { showConfirm, showMessage } from "../ui/app-dialog";
import { getActiveDocument } from "./app-bridge";
import type { PluginHost } from "./host/broker";
import { lazyModule } from "../lazy/lazy-module";
import { type PluginOrigin } from "./store/files";
import {
  engineSatisfied,
  parseManifest,
  type Permission,
} from "./store/manifest";
import { permissionLabel } from "./store/permissions";
import {
  addContribution,
  applyContributions,
  contributingPlugins,
  withdrawContributions,
  type ContributionDeps,
} from "./contributions/plugin-contributions";
import {
  removeWebview,
  webview,
  webviewForKey,
  webviewState,
  type WebviewRecord,
} from "./views/webviews";
import { canRun, canSwitch, nextStatus } from "./store/lifecycle";
import {
  pluginName,
  pluginRecord,
  pluginsSnapshot,
  publish,
  update,
  windowInfo,
  type PluginRecord,
} from "./store/plugin-records";

/**
 * Every installed plugin and a developer's loaded folder, with its switch,
 * grants and contributions. Contributions register from the manifest when on;
 * code starts on first use, or at startup if it asks.
 */

export type { PluginStatus } from "./store/lifecycle";
export {
  configurePlugins,
  pluginName,
  pluginRecord,
  pluginsSnapshot,
  pluginText,
  subscribePlugins,
  type PluginRecord,
  type PluginsSnapshot,
} from "./store/plugin-records";

const hosts = new Map<string, PluginHost>();

/** The system as a plugin is told it (textus.env.platform). */
export function pluginPlatform(): string {
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
  // Desktop only for now.
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
    for (const id of contributingPlugins()) withdraw(id);
    publish({ loaded: true, allOn: state.allOn, records });
    for (const record of records)
      if (canRun(record.status, state.allOn)) apply(record);
  })();
  return loading;
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

// The broker - the frame a plugin's code runs in and every call it makes -
// loads when the first plugin starts: a window with none on never does.
const brokerModule = lazyModule("plugin-broker", () => import("./host/broker"));

async function host(record: PluginRecord): Promise<PluginHost> {
  const { PluginHost } = await brokerModule.load();
  let running = hosts.get(record.id);
  if (!running && record.manifest) {
    running = new PluginHost(
      {
        manifest: record.manifest,
        origin: record.origin,
        granted: record.granted,
      },
      {
        strings: () => windowInfo().strings(),
        language: () => windowInfo().language(),
        dark: () => windowInfo().dark(),
        appVersion: APP_VERSION,
        platform: pluginPlatform(),
        setting: async (id, key) => pluginSetting(id, key),
        setSetting: (id, key, value) => setPluginSetting(id, key, value),
        pickWithCommands,
        runCommand: async (command, args) => {
          const owner = pluginsSnapshot().records.find(
            (r) => r.status === "on" && command.startsWith(`${r.id}.`),
          );
          if (owner) return runPluginCommand(owner.id, command, args);
          if (!runCommand(command, args))
            throw new Error(`No command ${command}.`);
          return null;
        },
        commandRegistered: (id, command, editor) => {
          const manifest = pluginRecord(id)?.manifest;
          const declared = manifest?.contributes.commands.some(
            (c) => c.command === command,
          );
          if (editor) editorCommands.add(command);
          if (declared || dynamicCommands.has(command)) return;
          dynamicCommands.set(
            command,
            registerCommand({
              id: command,
              title: () => command,
              run: (...args) => void runPluginCommand(id, command, args),
              enabled: () =>
                !editorCommands.has(command) || !!getActiveDocument(),
            }),
          );
          addContribution(id, () => removeDynamicCommand(command));
        },
        commandUnregistered: (_id, command) => {
          editorCommands.delete(command);
          removeDynamicCommand(command);
        },
        exportsOf: async (other) => {
          const target = pluginRecord(other);
          if (!target || !canRun(target.status, pluginsSnapshot().allOn))
            return null;
          const running = await host(target);
          await running.start();
          return running.exports;
        },
        callExport: async (other, name, args) => {
          const target = pluginRecord(other);
          if (!target || !canRun(target.status, pluginsSnapshot().allOn))
            throw new Error(`${other} is turned off.`);
          return (await host(target)).request("$callExport", { name, args });
        },
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
/** Commands that work on the document in front: offered only with one
 *  (registerEditorCommand). */
const editorCommands = new Set<string>();

function removeDynamicCommand(command: string) {
  dynamicCommands.get(command)?.();
  dynamicCommands.delete(command);
}

function stopHost(id: string) {
  hosts.get(id)?.stop();
  hosts.delete(id);
}

async function pluginFailed(id: string, reason: string) {
  logPluginError(id, reason);
  const record = pluginRecord(id);
  if (!record || record.status !== "on") return;
  stopHost(id);
  withdraw(id);
  update(id, {
    status: nextStatus(record.status, { type: "fail" }),
    problem: reason,
  });
  await pluginsIpc.set(id, false, record.granted).catch(() => {});
  const t = windowInfo().strings();
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

/** Asks a plugin's code, starting it first; `needs` is the permission
 *  the call is for, if any. */
export async function askPlugin(
  id: string,
  method: string,
  params: unknown,
  needs?: Permission,
): Promise<unknown> {
  const record = pluginRecord(id);
  if (!record || !canRun(record.status, pluginsSnapshot().allOn))
    throw new Error(`${id} is turned off.`);
  if (needs && !record.granted.includes(needs))
    throw new Error(`${id} was not granted ${needs}.`);
  return (await host(record)).request(method, params);
}

export function runPluginCommand(
  id: string,
  command: string,
  args: unknown[],
): Promise<unknown> {
  return askPlugin(id, "$executeCommand", { command, args });
}

/** Runs a tool the plugin gave Textus AI, starting it first. */
export function runPluginAiTool(
  id: string,
  name: string,
  args: unknown,
): Promise<unknown> {
  return askPlugin(id, "$callAiTool", { name, arguments: args }, "ai.tools");
}

/** Asks the plugin to fill a webview: a sidebar tab's or a view's panel,
 *  a custom editor, a settings page. */
export async function resolveWebview(
  record: WebviewRecord,
  target: {
    view?: string;
    viewType?: string;
    state?: unknown;
    target?: unknown;
    codeBlock?: CodeBlockSeen;
  },
): Promise<void> {
  const plugin = pluginRecord(record.plugin);
  if (!plugin || plugin.status !== "on")
    throw new Error(`${record.plugin} is turned off.`);
  const running = await host(plugin);
  if (record.kind === "editor")
    await running.request("$resolveFileEditor", {
      viewType: target.viewType,
      webview: record.id,
      path: record.resource,
      target: target.target ?? null,
    });
  else if (record.kind === "settings")
    await running.request("$resolveSettingsPage", { webview: record.id });
  else if (record.kind === "codeBlock")
    await running.request("$renderCodeBlock", {
      webview: record.id,
      ...target.codeBlock,
    });
  else
    await running.request("$resolveWebview", {
      view: target.view,
      webview: record.id,
      state: webviewState(record.key) ?? target.state ?? null,
    });
}

/** A code block as its plugin is shown it (textus CodeBlock). */
export interface CodeBlockSeen {
  language: string;
  source: string;
  /** What follows the language on the fence, read (parseFenceMeta). */
  meta: Record<string, string>;
  path: string | null;
  block: string;
}

/** A drawn code block's source or fence meta changed (CodeBlock.onDidChange). */
export function codeBlockChanged(
  record: WebviewRecord,
  seen: Pick<CodeBlockSeen, "source" | "meta" | "block">,
): void {
  hosts
    .get(record.plugin)
    ?.notify("$codeBlockChanged", { webview: record.id, ...seen });
}

/** A file editor already open in tab `tabId` asked to show a place
 *  (OpenFile.onDidRequestReveal). */
export function revealInPluginTab(tabId: string, target: unknown): void {
  const record = webviewForKey(`tab:${tabId}`);
  if (record)
    hosts
      .get(record.plugin)
      ?.notify("$revealFile", { webview: record.id, target });
}

/** A webview's frame message, for its plugin's code. */
export function webviewMessage(id: string, message: unknown): void {
  const record = webview(id);
  const plugin = record && pluginRecord(record.plugin);
  if (!record || !plugin || plugin.status !== "on") return;
  void host(plugin)
    .then((running) =>
      running.request("$webviewMessage", { webview: id, message }),
    )
    .catch(() => {});
}

export function disposeWebview(id: string): void {
  const record = removeWebview(id);
  if (!record) return;
  hosts.get(record.plugin)?.notify("$webviewDisposed", { webview: id });
}

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------

const contributionDeps: ContributionDeps = {
  runPluginCommand,
  start: async (id) => {
    const record = pluginRecord(id);
    if (record?.status === "on") await (await host(record)).start();
  },
};

function apply(record: PluginRecord) {
  applyContributions(record, contributionDeps);
}

function withdraw(id: string) {
  withdrawContributions(id, contributionDeps);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** A plugin's setting: the project's value, else the one for every
 *  document, else its manifest's default. */
export function pluginSetting(id: string, key: string): unknown {
  const { value, from } = pluginValue(id, key);
  if (from) return value;
  return (
    pluginRecord(id)?.manifest?.contributes.settings.find((s) => s.key === key)
      ?.default ?? null
  );
}

/** Sets a plugin's setting for every document, or for the open project. */
export async function setPluginSetting(
  id: string,
  key: string,
  value: unknown,
  scope: SettingScope = "global",
): Promise<void> {
  await setPluginValue(id, key, value, scope);
  update(id, {});
  hosts.get(id)?.event("settings", { key, value: pluginSetting(id, key) });
}

/** A project opened or closed: its plugins hear the settings it changes. */
export async function setPluginProject(root: string | null): Promise<void> {
  const before = new Map<string, unknown>();
  const running = pluginsSnapshot().records.filter((r) => hosts.has(r.id));
  for (const r of running)
    for (const s of r.manifest?.contributes.settings ?? [])
      before.set(`${r.id}\u0000${s.key}`, pluginSetting(r.id, s.key));
  await loadProjectPluginSettings(root);
  for (const r of running)
    for (const s of r.manifest?.contributes.settings ?? []) {
      const value = pluginSetting(r.id, s.key);
      if (before.get(`${r.id}\u0000${s.key}`) !== value)
        hosts.get(r.id)?.event("settings", { key: s.key, value });
    }
  for (const r of running) update(r.id, {});
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
  const t = windowInfo().strings();
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
  if (canRun(next.status, pluginsSnapshot().allOn)) apply(next);
}

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
  if (!on) for (const id of contributingPlugins()) withdraw(id);
  publish({ allOn: on });
  for (const record of pluginsSnapshot().records)
    if (canRun(record.status, on)) apply(record);
}

export async function reloadPlugin(id: string): Promise<void> {
  stopHost(id);
  withdraw(id);
  await loadPlugins(true);
}

/** A package or folder at `source`, or files Textus AI wrote, installed. */
export async function installPlugin(
  source: string | PluginFile[],
): Promise<string> {
  const installed = await (typeof source === "string"
    ? pluginsIpc.install(source)
    : pluginsIpc.installFiles(source));
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
  await forgetPluginSettings(id);
  await pluginsIpc.uninstall(id);
  await loadPlugins(true);
}
