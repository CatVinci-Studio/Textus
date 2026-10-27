import {
  plugins as pluginsIpc,
  type PluginCatalogEntry,
} from "../../platform/ipc";
import type { SkillEntry_Serialize as SkillEntry } from "../../platform/bindings/plugins";
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
} from "../manager";
import { errorText } from "../../utils/error-text";

/**
 * The plugins Textus offers to install, from the textus-plugins catalog that
 * Rust fetches, checks and installs. No plugin comes with Textus.
 */

export interface CatalogItem {
  id: string;
  version: string;
  official: boolean;
  manifest: PluginManifest;
  size: number;
  /** Pictures of it at work, from the catalog's release. */
  screenshots: string[];
}

export type { SkillEntry };

/** Ready with last time's list while a fresh one is fetched; `error` when
 *  fetching failed. `skills`: the skills the same catalog lists. */
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
      screenshots: entry.screenshots,
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

/** Fetches the catalog (again, with `force`). Last time's list shows at once
 *  the first time; when fetching fails, a list already shown stays. */
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

/** Installs (or updates) `id` from the catalog. A new plugin is turned on,
 *  which asks for its permissions; an update keeps it as it was. */
export async function installFromCatalog(id: string): Promise<void> {
  const before = pluginRecord(id);
  await pluginsIpc.installFromCatalog(id);
  await loadPlugins(true);
  const wasOn = before?.status === "on";
  if (!before || wasOn) await setPluginEnabled(id, true);
}

export type PackId = "writing" | "charts" | "research";

/** Plugins offered to install together: the official ones, by purpose. A
 *  pack shows the ones the catalog has. */
export const PLUGIN_PACKS: { id: PackId; plugins: string[] }[] = [
  {
    id: "writing",
    plugins: [
      "catvinci.markdown-lint",
      "catvinci.cjk-spacing",
      "catvinci.heading-numbers",
      "catvinci.templates",
      "catvinci.bookmarks",
    ],
  },
  {
    id: "charts",
    plugins: [
      "catvinci.markmap",
      "catvinci.echarts",
      "catvinci.plantuml",
      "catvinci.chartjs",
      "catvinci.timeline",
      "catvinci.abc",
      "catvinci.wavedrom",
      "catvinci.function-plot",
    ],
  },
  {
    id: "research",
    plugins: [
      "catvinci.zotero",
      "catvinci.pdf-viewer",
      "catvinci.daily-notes",
      "catvinci.graph",
    ],
  },
];

/** The plugins Get more puts first while nothing is searched for. */
export const RECOMMENDED_PLUGINS = [
  "catvinci.pdf-viewer",
  "catvinci.image-viewer",
  "catvinci.tasks",
  "catvinci.daily-notes",
];

/** The catalog's plugins not installed yet. */
export function notInstalled(from: CatalogState = state): CatalogItem[] {
  if (from.status !== "ready") return [];
  const installed = new Set(pluginsSnapshot().records.map((r) => r.id));
  return from.items.filter((i) => !installed.has(i.id));
}

/** The items whose name, description, author or id hold every word of
 *  `query`, case aside, in the UI language and the manifest's own. */
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
