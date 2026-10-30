import { connectFrame, hostsContainer, sandboxedFrame } from "./frames";
import { hostDocument } from "./host-document";
import { fileHandlers } from "./broker-files";
import { scheduleHandlers } from "./broker-schedule";
import { withTimeout, type BrokerDeps, type PluginRuntimeInfo } from "./broker";
import { str, type Params, type PluginScope } from "./broker-scope";
import type { Endpoint } from "./rpc";
import { readPluginFile } from "../store/files";
import { logPluginError, logPluginMessage } from "../store/plugin-log";
import type { AppState } from "../../platform/ipc-schedule";

/**
 * One run of a plugin's background code: a sandboxed frame of its own with
 * the manifest's `background` file, the restricted calls, its export of the
 * job's `run` name called, then the frame removed - after 30 seconds
 * whatever it is doing. The plugin's main code isn't started for it.
 */

export const RUN_MS = 30_000;

/** The calls background code may make, by their prefix: its files, the
 *  network, its storage and secrets. */
const ALLOWED = ["files.", "net.", "store.", "secrets."];
/** Of those, the ones that hook into a window's saving. */
const WINDOW_ONLY = new Set(["files.willSave", "export.willExport"]);

export interface BackgroundRun {
  info: PluginRuntimeInfo;
  /** The job's id and the export it runs. */
  job: string;
  run: string;
  due: number;
  /** The folder open when the job was set (files.read only). */
  root: string | null;
  env: {
    language: string;
    appVersion: string;
    platform: string;
    theme: "light" | "dark";
    appState: AppState;
  };
  /** One of the plugin's settings. */
  setting(key: string): Promise<unknown>;
}

/** What background code can't reach throws, should a call get here. */
const noWindow = new Proxy({} as BrokerDeps, {
  get: () => () => {
    throw new Error("Not available in background code.");
  },
});

function scopeOf(run: BackgroundRun): PluginScope {
  const id = run.info.manifest.id;
  const need: PluginScope["need"] = (permission) => {
    if (!run.info.granted.includes(permission))
      throw new Error(`${id} was not granted ${permission}.`);
  };
  return {
    id,
    info: run.info,
    deps: noWindow,
    name: () => run.info.manifest.name,
    t: () => noWindow.strings(),
    manifest: () => run.info.manifest,
    need,
    root: () => {
      need("files.read");
      if (!run.root) throw new Error("The job was set with no folder open.");
      return run.root;
    },
    ownWebview: () => {
      throw new Error("Background code has no webviews.");
    },
    readOwnFile: (rel) => readPluginFile(id, run.info.origin, rel),
    request: () => Promise.reject(new Error("No such call.")),
    event: () => {},
  };
}

export function backgroundHandlers(run: BackgroundRun) {
  const scope = scopeOf(run);
  const files = Object.fromEntries(
    Object.entries(fileHandlers(scope)).filter(
      ([name]) =>
        ALLOWED.some((prefix) => name.startsWith(prefix)) &&
        !WINDOW_ONLY.has(name),
    ),
  );
  return {
    "host.error": ({ message }: Params) =>
      logPluginError(scope.id, String(message ?? "error")),
    log: ({ level, message }: Params) =>
      logPluginMessage(
        scope.id,
        level === "error" || level === "warn" ? level : "info",
        String(message ?? ""),
      ),
    // Background code hears no events: it runs and ends.
    "events.subscribe": () => {},
    "plugin.readFile": ({ path }: Params) =>
      scope.readOwnFile(str(path, "path")),
    "settings.get": ({ key }: Params) => run.setting(str(key, "key")),
    ...files,
    ...scheduleHandlers(scope, () => run.root),
    "app.state": () => run.env.appState,
  };
}

/** Runs the job's export; rejects when it throws or takes too long. */
export async function runBackground(
  run: BackgroundRun,
  timeoutMs = RUN_MS,
): Promise<void> {
  const { manifest, origin } = run.info;
  if (!manifest.background)
    throw new Error(`${manifest.id} has no background code.`);
  const code = new TextDecoder().decode(
    await readPluginFile(manifest.id, origin, manifest.background),
  );
  const frame = sandboxedFrame(hostDocument(code, true), manifest.id);
  let disconnect = () => {};
  const connected = new Promise<Endpoint>((resolve) => {
    disconnect = connectFrame(
      frame,
      backgroundHandlers(run),
      () => ({
        env: {
          pluginId: manifest.id,
          pluginVersion: manifest.version,
          ...run.env,
          l10n: manifest.l10n,
        },
      }),
      resolve,
    );
  });
  hostsContainer().append(frame);
  try {
    await withTimeout(
      connected.then((endpoint) =>
        endpoint.call("$runJob", { job: run.job, run: run.run, due: run.due }),
      ),
      timeoutMs,
      `${manifest.id}'s ${run.run}`,
    );
  } finally {
    disconnect();
    frame.remove();
  }
}
