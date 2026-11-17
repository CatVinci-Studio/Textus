import { str, type Params, type PluginScope } from "./broker-scope";

/**
 * Where a document's past versions are kept besides Textus's own - Git, a
 * sync service - offered by the plugins that know them, for another plugin
 * (Version History) to list and read. Every call reads files: files.read.
 */
interface HistorySource {
  plugin: string;
  id: string;
  label: string;
  scope: PluginScope;
}

/** By `<plugin id>/<source id>`, the id other plugins name it by. */
const sources = new Map<string, HistorySource>();

/** One past version, as a source answers it. */
interface HistoryVersion {
  id: string;
  /** When, as an ISO date. */
  at: string;
  label?: string;
  author?: string;
}

/** A source's answer as versions: anything without an id and a date left
 *  out, newest first. */
function versionsFrom(value: unknown): HistoryVersion[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const { id, at, label, author } = (item ?? {}) as Record<string, unknown>;
      if (typeof id !== "string" || !id) return [];
      if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return [];
      return [
        {
          id,
          at,
          ...(typeof label === "string" ? { label } : {}),
          ...(typeof author === "string" ? { author } : {}),
        },
      ];
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function sourceOf(name: unknown): HistorySource {
  const key = str(name, "source");
  const source = sources.get(key);
  if (!source) throw new Error(`No history source ${key}.`);
  return source;
}

export function historyHandlers(p: PluginScope) {
  return {
    "history.registerSource": ({ id, label }: Params) => {
      const own = str(id, "id");
      sources.set(`${p.id}/${own}`, {
        plugin: p.id,
        id: own,
        label: str(label, "label"),
        scope: p,
      });
    },
    "history.unregisterSource": ({ id }: Params) => {
      sources.delete(`${p.id}/${str(id, "id")}`);
    },
    "history.sources": () =>
      [...sources.entries()].map(([key, s]) => ({
        id: key,
        label: s.label,
        plugin: s.plugin,
      })),
    "history.versions": async ({ source, path }: Params) => {
      const s = sourceOf(source);
      return versionsFrom(
        await s.scope.request("$historyVersions", {
          id: s.id,
          path: str(path, "path"),
        }),
      );
    },
    "history.read": async ({ source, path, version }: Params) => {
      const s = sourceOf(source);
      const text = await s.scope.request("$historyRead", {
        id: s.id,
        path: str(path, "path"),
        version: str(version, "version"),
      });
      if (typeof text !== "string")
        throw new Error(`${s.label} has no such version.`);
      return text;
    },
  };
}

/** A plugin stopped: its sources go. */
export function stopPluginHistory(plugin: string): void {
  for (const [key, source] of sources)
    if (source.plugin === plugin) sources.delete(key);
}
