import { version as APP_VERSION } from "../../../package.json";
import {
  plugins as pluginsIpc,
  type InstalledPlugin,
  type PluginsState,
} from "../../platform/ipc";
import {
  schedule as scheduleIpc,
  type AppState,
  type JobRun,
} from "../../platform/ipc-schedule";
import { lazyModule } from "../../lazy/lazy-module";
import { parseManifest, type Permission } from "../store/manifest";
import { globalPluginValue } from "../store/plugin-settings";
import { logPluginError } from "../store/plugin-log";

/**
 * The background runs Rust has waiting, each taken and run in a frame of its
 * own: by an editor window, or the hidden window opened for them. The plugin
 * is read from disk, not from the window's records, so a window that hasn't
 * loaded its plugins - or the hidden one, which never does - runs them alike.
 */

const host = lazyModule(
  "plugin-background-host",
  () => import("../host/background-host"),
);

/** What a run is told of where it runs. */
export interface RunPlace {
  language: string;
  platform: string;
  theme: "light" | "dark";
  appState: () => AppState;
}

/** A plugin's setting for every folder, else its manifest's default. */
function settingOf(
  plugin: string,
  defaults: { key: string; default?: unknown }[],
  key: string,
): unknown {
  return (
    globalPluginValue(plugin, key) ??
    defaults.find((s) => s.key === key)?.default ??
    null
  );
}

async function runOne(
  run: JobRun,
  state: PluginsState,
  installed: InstalledPlugin[],
  place: RunPlace,
): Promise<void> {
  const entry = state.plugins[run.plugin];
  const plugin = installed.find((p) => p.id === run.plugin);
  const granted = (entry?.granted ?? []) as Permission[];
  if (!state.allOn || !entry?.enabled || !plugin) return;
  if (!granted.includes("background")) return;
  const manifest = parseManifest(plugin.manifest);
  const { runBackground } = await host.load();
  await runBackground({
    info: { manifest, origin: plugin.dev ? "dev" : "installed", granted },
    job: run.job,
    run: run.run,
    due: run.due ?? Date.now(),
    root: run.root,
    env: {
      language: place.language,
      appVersion: APP_VERSION,
      platform: place.platform,
      theme: place.theme,
      appState: place.appState(),
    },
    setting: async (key) =>
      settingOf(manifest.id, manifest.contributes.settings, key),
  });
}

/** Takes and runs what is waiting; how many there were. */
export async function runWaitingJobs(place: RunPlace): Promise<number> {
  const runs = await scheduleIpc.takeRuns();
  if (!runs.length) return 0;
  const [state, installed] = await Promise.all([
    pluginsIpc.state(),
    pluginsIpc.installed(),
  ]);
  await Promise.all(
    runs.map((run) =>
      runOne(run, state, installed, place).catch((err: unknown) =>
        logPluginError(
          run.plugin,
          `${run.run}: ${String((err as Error)?.message ?? err)}`,
        ),
      ),
    ),
  );
  return runs.length;
}
