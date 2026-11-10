import {
  readProjectSettings,
  updateProjectSettings,
} from "../../storage/project-settings";
import { isRecord } from "../../prefs/settings-sync";
import {
  loadSettings,
  persist,
  subscribeRemote,
} from "../../prefs/settings-store";

/**
 * A plugin's settings, kept under `plugins.<id>` in settings.json and, for a
 * project, in its `.textus/settings.json` over those. A plugin reads the
 * project's value, else the global one, else its manifest's default.
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
  const plugins = (await readProjectSettings(root)).plugins;
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

/** Whether a setting with `when` shows given the other settings' values:
 *  "legend", "!legend", "style == dark", "style != dark". */
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
  let next: Layer = {};
  await updateProjectSettings(root, "plugins", (plugins) => {
    next = { ...(plugins as Layer), [id]: put((plugins as Layer)[id]) };
    if (Object.keys(next[id]).length === 0) delete next[id];
    return next;
  });
  // Still that folder: one opened meanwhile keeps its own.
  if (project?.root === root) project = { root, values: next };
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
