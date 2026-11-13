import type { QuickPickItem } from "../../engine/controls/quick-pick-queue";
import { matchesWords } from "../../utils/match-words";
import type { Strings } from "../../i18n/strings";
import type { Shortcuts } from "../../prefs/SettingsContext";
import type { PluginOrigin } from "./files";
import { localize, type Permission, type PluginManifest } from "./manifest";
import { canRun, type PluginStatus } from "./lifecycle";

/**
 * The plugins as the window draws them: one record per plugin, published to
 * whatever listens whenever one changes.
 */

export interface PluginRecord {
  id: string;
  origin: PluginOrigin;
  manifest: PluginManifest | null;
  status: PluginStatus;
  granted: Permission[];
  problem?: string;
  /** Where its files are, for one on disk. */
  dir?: string;
  /** Installed from the catalog as CatVinci's own: Settings marks it Official. */
  official: boolean;
}

export interface PluginsSnapshot {
  loaded: boolean;
  allOn: boolean;
  records: PluginRecord[];
}

let snapshot: PluginsSnapshot = { loaded: false, allOn: true, records: [] };
const listeners = new Set<() => void>();

/** What the window tells the manager about itself. */
interface WindowInfo {
  strings: () => Strings;
  language: () => string;
  dark: () => boolean;
  /** The app's shortcuts and the user's keys for commands, as Settings has
   *  them; the defaults when left out. */
  keys?: () => { shortcuts: Shortcuts; overrides: Record<string, string> };
  /** The command palette, offering `items` (a plugin's ui.pick): the
   *  window's own. */
  pickWithCommands?: (
    items: QuickPickItem[],
    query: string,
    placeholder?: string,
  ) => Promise<unknown>;
}

let info: WindowInfo = {
  strings: () => {
    throw new Error("Plugins are not set up yet.");
  },
  language: () => "en",
  dark: () => false,
};

export function configurePlugins(next: WindowInfo): void {
  info = next;
}

export function windowInfo(): WindowInfo {
  return info;
}

export function publish(next: Partial<PluginsSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export function update(id: string, change: Partial<PluginRecord>) {
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

/** The plugins running now - each on, every plugin switched on - with
 *  their manifests: what every contribution is read from. */
export function runningPlugins(
  from: PluginsSnapshot,
): (PluginRecord & { manifest: PluginManifest })[] {
  return from.records.filter(
    (r): r is PluginRecord & { manifest: PluginManifest } =>
      canRun(r.status, from.allOn) && !!r.manifest,
  );
}

export function pluginsSnapshot(): PluginsSnapshot {
  return snapshot;
}

export function pluginRecord(id: string): PluginRecord | undefined {
  return snapshot.records.find((r) => r.id === id);
}

/** Whether a plugin's code may run now: its own switch and "all plugins"
 *  both on. */
export function pluginMayRun(
  record: PluginRecord | null | undefined,
): record is PluginRecord {
  return !!record && canRun(record.status, snapshot.allOn);
}

/** The error a plugin's page shows while the plugin may not run. */
export const PLUGIN_OFF = "plugin-off";

/** A plugin's name in the UI language. */
export function pluginName(
  record: Pick<PluginRecord, "id" | "manifest">,
): string {
  return record.manifest
    ? localize(record.manifest, record.manifest.name, info.language())
    : record.id;
}

export function pluginText(
  record: Pick<PluginRecord, "manifest">,
  value: string,
): string {
  return record.manifest
    ? localize(record.manifest, value, info.language())
    : value;
}

/** Whether the plugin's name, description, author or id holds every word
 *  of `query`, case aside, in the UI language and the manifest's own. */
export function pluginMatches(
  record: Pick<PluginRecord, "id" | "manifest">,
  query: string,
): boolean {
  const m = record.manifest;
  const text = [
    pluginName(record),
    m?.name,
    m && pluginText(record, m.description),
    m?.description,
    m?.author,
    m?.publisher,
    record.id,
  ].join("\n");
  return matchesWords(text, query);
}
