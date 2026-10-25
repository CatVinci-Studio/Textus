import {
  plugins as pluginsIpc,
  type PluginCatalogEntry,
} from "../platform/ipc";
import type { SkillEntry_Serialize as SkillEntry } from "../platform/bindings/plugins";
import {
  parseManifest,
  compareVersions,
  type PluginManifest,
} from "./manifest";
import {
  loadPlugins,
  pluginName,
  pluginRecord,
  pluginText,
  pluginsSnapshot,
  setPluginEnabled,
} from "./manager";
import { errorText } from "../utils/error-text";

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

export type { SkillEntry };

/** Ready with the list kept from last time while a fresh one is fetched;
 *  `error` when fetching it failed and the kept list is what there is.
 *  `skills`: the skills the same catalog lists, for the market. */
export type CatalogState =
  | { status: "idle" | "loading" }
  | {
      status: "ready";
      items: CatalogItem[];
      skills: SkillEntry[];
      error?: string;
    }
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

const items = (entries: PluginCatalogEntry[]) =>
  entries.map(item).filter((i): i is CatalogItem => i !== null);

let fetching: Promise<void> | null = null;

/** The skills the catalog just read lists; none from an older backend. */
const skills = (): Promise<SkillEntry[]> =>
  pluginsIpc.skillCatalog().catch(() => []);

/** Fetches the catalog (again, with `force`). The first time, the list
 *  kept from last time is shown at once while the fresh one comes; when
 *  fetching fails, a list already shown stays. */
export function loadCatalog(force = false): Promise<void> {
  if (fetching) return fetching;
  if (!force && state.status === "ready") return Promise.resolve();
  fetching = (async () => {
    if (state.status !== "ready") {
      publish({ status: "loading" });
      const kept = await pluginsIpc.cachedCatalog().catch(() => null);
      if (kept)
        publish({
          status: "ready",
          items: items(kept),
          skills: await skills(),
        });
    }
    try {
      const fresh = items(await pluginsIpc.catalog());
      publish({ status: "ready", items: fresh, skills: await skills() });
    } catch (err) {
      const error = errorText(err);
      publish(
        state.status === "ready"
          ? { ...state, error }
          : { status: "failed", error },
      );
    }
  })().finally(() => {
    fetching = null;
  });
  return fetching;
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

/** The items whose name, description, author or id hold every word of
 *  `query`, case aside - in the UI language and in the manifest's own. */
export function searchCatalog(
  list: CatalogItem[],
  query: string,
): CatalogItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((i) => {
    const m = i.manifest;
    const text = [
      pluginName({ id: i.id, manifest: m }),
      m.name,
      pluginText({ manifest: m }, m.description),
      m.description,
      m.author,
      m.publisher,
      i.id,
    ]
      .join("\n")
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
