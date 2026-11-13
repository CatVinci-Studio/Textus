import { grants } from "./grants";
import { fill } from "../i18n/fill";
import { explainError } from "../utils/error-explain";
import { logPluginError } from "./store/plugin-log";
import { version as APP_VERSION } from "../../package.json";
import { plugins as pluginsIpc, type PluginsState } from "../platform/ipc";
import { registerCommand, runCommand } from "../registry/commands";
import { showMessage } from "../engine/controls/app-dialog";
import { getActiveDocument } from "./app-bridge";
import type { PluginHost } from "./host/broker";
import { lazyModule } from "../lazy/lazy-module";
import { type PluginOrigin } from "./store/files";
import { parseManifest, type Permission } from "./store/manifest";
import { engineSatisfied } from "./store/versions";
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
import { canRun, nextStatus } from "./store/lifecycle";
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

import { compareNames } from "../utils/name-order";
import { pluginPlatform, runsHere } from "./plugin-platform";
import { hosts, stopHost } from "./running-hosts";
import { pluginSetting, setPluginSetting } from "./plugin-setting-values";

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
    const compatible =
      engineSatisfied(manifest.engine, APP_VERSION) && runsHere(manifest);
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

/** The same plugin, run the same way: nothing to withdraw or apply. */
const runsAlike = (a: PluginRecord, b: PluginRecord) =>
  a.dir === b.dir &&
  a.status === b.status &&
  a.granted.join() === b.granted.join() &&
  JSON.stringify(a.manifest) === JSON.stringify(b.manifest);

/** Reads every plugin and turns on those that are on. Once per window;
 *  `reload` reads them again (after an install, or another window's change)
 *  and changes only what differs: the window that made a change finds
 *  nothing left to do. */
export function loadPlugins(reload = false): Promise<void> {
  if (loading && !reload) return loading;
  loading = (async () => {
    let state: PluginsState;
    let installed: Awaited<ReturnType<typeof pluginsIpc.installed>>;
    try {
      [state, installed] = await Promise.all([
        pluginsIpc.state(),
        pluginsIpc.installed(),
      ]);
    } catch (err) {
      // Not "none installed": what runs keeps running, and the user hears.
      const t = windowInfo().strings();
      void showMessage(
        fill(t.pluginsReadFailed, { reason: explainError(err, t) }),
      );
      if (!pluginsSnapshot().loaded) publish({ loaded: true });
      return;
    }
    const records: PluginRecord[] = [];
    for (const p of installed)
      records.push(
        makeRecord(p.id, p.dev ? "dev" : "installed", p.manifest, state, p.dir),
      );
    records.sort((a, b) => compareNames(pluginName(a), pluginName(b)));
    const was = pluginsSnapshot();
    const before = new Map(was.records.map((r) => [r.id, r]));
    const kept = (record: PluginRecord) => {
      const old = before.get(record.id);
      return (
        !!old &&
        canRun(old.status, was.allOn) &&
        canRun(record.status, state.allOn) &&
        runsAlike(old, record)
      );
    };
    const keep = new Set(records.filter(kept).map((r) => r.id));
    for (const id of contributingPlugins())
      if (!keep.has(id)) {
        stopHost(id);
        withdraw(id);
      }
    publish({ loaded: true, allOn: state.allOn, records });
    for (const record of records)
      if (canRun(record.status, state.allOn) && !keep.has(record.id))
        apply(record);
  })();
  return loading;
}

// Another window changed which plugins are on: read them again.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen("plugins-changed", () => {
      if (loading) void loadPlugins(true);
    }),
  );

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
        pickWithCommands: (items, query, placeholder) =>
          windowInfo().pickWithCommands?.(items, query, placeholder) ??
          Promise.resolve(null),
        runCommand: async (command, args, caller) => {
          const owner = pluginsSnapshot().records.find(
            (r) => r.status === "on" && command.startsWith(`${r.id}.`),
          );
          // Another plugin reaches only the commands this one lists.
          if (
            owner &&
            caller !== owner.id &&
            !owner.manifest?.contributes.commands.some(
              (c) => c.command === command,
            )
          )
            throw new Error(`${command} isn't one of ${owner.id}'s commands.`);
          if (owner) return runPluginCommand(owner.id, command, args);
          if (!runCommand(command, args))
            throw new Error(`No command ${command}.`);
          return null;
        },
        offerPlugin: (caller, request) =>
          import("./store/open-offer").then((offer) =>
            offer.offerPlugin(caller, request, windowInfo().strings()),
          ),
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
        commandUnregistered: (id, command) => {
          // Only its own, as registering is.
          if (!command.startsWith(`${id}.`)) return;
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
    fill(t.pluginFailedNotice, { name: pluginName(record), reason }),
    {
      title: t.pluginsTitle,
      tone: "warning",
    },
  );
}

/** The plugin's record, once the window's first read of the plugins is
 *  done: a tab restored by a reload asks before that read ends. */
async function loadedRecord(id: string) {
  if (!pluginRecord(id) && loading) await loading;
  return pluginRecord(id);
}

/** Asks a plugin's code, starting it first; `needs` is the permission
 *  the call is for, if any. */
export async function askPlugin(
  id: string,
  method: string,
  params: unknown,
  needs?: Permission,
): Promise<unknown> {
  const record = await loadedRecord(id);
  if (!record || !canRun(record.status, pluginsSnapshot().allOn))
    throw new Error(`${id} is turned off.`);
  if (needs && !grants(record.granted, needs))
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
  const plugin = await loadedRecord(record.plugin);
  if (!plugin || plugin.status !== "on")
    throw new Error(`${record.plugin} is turned off.`);
  const running = await host(plugin);
  // Gone while the plugin started: drawn now, nothing would let it go.
  if (!webview(record.id)) return;
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

/** A plugin's contributions in; its code starts on first use. */
export function apply(record: PluginRecord) {
  applyContributions(record, contributionDeps);
}

/** A plugin's contributions out. */
export function withdraw(id: string) {
  withdrawContributions(id, contributionDeps);
}
