import { fs } from "../../platform/ipc";
import { isRecord } from "../../settings/settings-sync";
import {
  loadSettings,
  persist,
  subscribeRemote,
} from "../../settings/settings-store";

/**
 * A plugin's settings, kept with Textus's own (1.3): for every document in
 * settings.json, under `plugins.<id>`; for a project in its folder's
 * `.textus/settings.json`, under the same key, over those. What a plugin
 * reads is the project's value, else the global one, else its manifest's
 * default (manager.ts). Before, they were a key of the plugin's own
 * storage, out of sight and one for every project.
 */

/** Where a value is kept. */
export type SettingScope = "global" | "project";

type Layer = Record<string, Record<string, unknown>>;

let project: { root: string; values: Layer } | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** Calls `fn` whenever a plugin setting may have changed: set here, in
 *  another window, or a project's opened. */
export function onPluginSettingsChange(fn: () => void): () => void {
  listeners.add(fn);
  const stop = subscribeRemote(fn);
  return () => {
    listeners.delete(fn);
    stop();
  };
}

const projectFile = (root: string) => `${root}/.textus/settings.json`;

/** The project's settings file as a whole, or nothing. */
async function readProjectFile(root: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.readTextFile(projectFile(root)),
    );
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Reads the plugin settings of the folder now open (null: none). */
export async function loadProjectPluginSettings(
  root: string | null,
): Promise<void> {
  if (!root) {
    if (project) {
      project = null;
      notify();
    }
    return;
  }
  if (project?.root === root) return;
  const plugins = (await readProjectFile(root)).plugins;
  project = {
    root,
    values: isRecord(plugins)
      ? (Object.fromEntries(
          Object.entries(plugins).filter(([, v]) => isRecord(v)),
        ) as Layer)
      : {},
  };
  notify();
}

/** The folder whose settings are read, if one is open. */
export function projectRoot(): string | null {
  return project?.root ?? null;
}

/** A setting's value and where it comes from; `from` null: neither layer
 *  holds it, so the manifest's default is meant. */
export function pluginValue(
  id: string,
  key: string,
): { value: unknown; from: SettingScope | null } {
  const own = project?.values[id];
  if (own && key in own) return { value: own[key], from: "project" };
  const global = loadSettings().plugins[id];
  if (global && key in global) return { value: global[key], from: "global" };
  return { value: undefined, from: null };
}

/** Whether a setting with `when` shows, as the other settings are now
 *  (`value` of a key): "legend" while legend is on (or set), "!legend"
 *  while it isn't, "style == dark" / "style != dark" by its value. */
export function settingShown(
  when: string | undefined,
  value: (key: string) => unknown,
): boolean {
  if (!when) return true;
  const m = /^\s*(!?)([\w.-]+)\s*(?:(==|!=)\s*(.+?))?\s*$/.exec(when);
  if (!m) return true;
  const [, not, key, op, expected] = m;
  const current = value(key);
  if (!op) {
    const on = Array.isArray(current) ? current.length > 0 : !!current;
    return not ? !on : on;
  }
  return (String(current) === expected) === (op === "==");
}

/** The value for every document alone, or undefined. */
export function globalPluginValue(id: string, key: string): unknown {
  return loadSettings().plugins[id]?.[key];
}

/** Keeps `value` for `key` in `scope`; undefined takes it out of that
 *  layer, so the one under it shows through. */
export async function setPluginValue(
  id: string,
  key: string,
  value: unknown,
  scope: SettingScope,
): Promise<void> {
  const put = (layer: Record<string, unknown> | undefined) => {
    const next = { ...(layer ?? {}) };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  };
  if (scope === "global") {
    const all = loadSettings().plugins;
    persist({ plugins: { ...all, [id]: put(all[id]) } });
    notify();
    return;
  }
  if (!project) throw new Error("No folder is open.");
  const { root } = project;
  const file = await readProjectFile(root);
  const plugins = isRecord(file.plugins) ? (file.plugins as Layer) : {};
  const next = { ...plugins, [id]: put(plugins[id]) };
  if (Object.keys(next[id]).length === 0) delete next[id];
  await fs.writeTextFile(
    projectFile(root),
    JSON.stringify({ ...file, plugins: next }, null, 2) + "\n",
  );
  project = { root, values: next };
  notify();
}

/** Forgets a plugin's settings everywhere it can (it was uninstalled). */
export async function forgetPluginSettings(id: string): Promise<void> {
  const all = { ...loadSettings().plugins };
  if (id in all) {
    delete all[id];
    persist({ plugins: all });
  }
  notify();
}
