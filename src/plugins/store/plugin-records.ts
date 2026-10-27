import type { Strings } from "../../i18n/strings";
import type { PluginOrigin } from "./files";
import { localize, type Permission, type PluginManifest } from "./manifest";
import type { PluginStatus } from "./lifecycle";

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
export interface WindowInfo {
  strings: () => Strings;
  language: () => string;
  dark: () => boolean;
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
