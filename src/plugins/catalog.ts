import {
  plugins as pluginsIpc,
  type PluginCatalogEntry,
} from "../platform/ipc";
import {
  parseManifest,
  compareVersions,
  type PluginManifest,
} from "./manifest";
import {
  loadPlugins,
  pluginRecord,
  pluginsSnapshot,
  setPluginEnabled,
} from "./manager";

/**
 * The plugins Textus offers to install (Settings › Extensions › Plugins › Get plugins):
 * textus-plugins' catalog, fetched by Rust (src-tauri/src/plugins/
 * catalog.rs), which also downloads, checks and installs a package. No
 * plugin comes with Textus.
 */

export interface CatalogItem {
  id: string;
  version: string;
  official: boolean;
  manifest: PluginManifest;
  size: number;
}

export type CatalogState =
  | { status: "idle" | "loading" }
  | { status: "ready"; items: CatalogItem[] }
  | { status: "failed"; error: string };

let state: CatalogState = { status: "idle" };
const listeners = new Set<() => void>();

function publish(next: CatalogState) {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function catalogSnapshot(): CatalogState {
  return state;
}

/** A catalog entry whose manifest can't be read is left out. */
function item(entry: PluginCatalogEntry): CatalogItem | null {
  try {
    return {
      id: entry.id,
      version: entry.version,
      official: entry.official,
      manifest: parseManifest(entry.manifest),
      size: entry.size,
    };
  } catch {
    return null;
  }
}

/** Fetches the catalog (again, with `force`). */
export async function loadCatalog(force = false): Promise<void> {
  if (!force && (state.status === "loading" || state.status === "ready"))
    return;
  publish({ status: "loading" });
  try {
    const entries = await pluginsIpc.catalog();
    publish({
      status: "ready",
      items: entries.map(item).filter((i): i is CatalogItem => i !== null),
    });
  } catch (err) {
    publish({
      status: "failed",
      error: String((err as Error)?.message ?? err),
    });
  }
}

/** The catalog's newer version of an installed plugin, if it has one. */
export function updateFor(
  id: string,
  from: CatalogState = state,
): string | null {
  if (from.status !== "ready") return null;
  const installed = pluginRecord(id)?.manifest?.version;
  const offered = from.items.find((i) => i.id === id)?.version;
  return installed && offered && compareVersions(offered, installed) > 0
    ? offered
    : null;
}

/** Installs (or updates) `id` from the catalog. A new plugin is turned
 *  on - installing it was asking for it - which asks for its
 *  permissions; an update keeps it as it was. */
export async function installFromCatalog(id: string): Promise<void> {
  const before = pluginRecord(id);
  await pluginsIpc.installFromCatalog(id);
  await loadPlugins(true);
  const wasOn = before?.status === "on";
  if (!before || wasOn) await setPluginEnabled(id, true);
}

/** The catalog's plugins not installed yet. */
export function notInstalled(from: CatalogState = state): CatalogItem[] {
  if (from.status !== "ready") return [];
  const installed = new Set(pluginsSnapshot().records.map((r) => r.id));
  return from.items.filter((i) => !installed.has(i.id));
}
