import { rankList, type PreparedList } from "../../utils/list-filter";
import type { CompletionSource, PanelItem } from "./sources";

/**
 * What the panel shows, worked out from what is typed: which sources match
 * before the caret, in what order their groups go, and the rows. Pure, so
 * the order rules are tested without an editor.
 */

export interface SourceMatch {
  source: CompletionSource;
  /** What an item replaces, before the caret. */
  match: string;
  query: string;
}

const isCore = (source: CompletionSource) => source.owner === "core";

/** Longer match first ("[@" over "@"), then the core's, then by plugin. */
function compareMatches(a: SourceMatch, b: SourceMatch): number {
  return (
    b.match.length - a.match.length ||
    Number(isCore(b.source)) - Number(isCore(a.source)) ||
    (a.source.owner < b.source.owner
      ? -1
      : a.source.owner > b.source.owner
        ? 1
        : 0)
  );
}

/** The sources whose pattern matches `text` (before the caret), in group
 *  order; a fallback goes when a plugin's matches from the same place. */
export function matchSources(
  sources: readonly CompletionSource[],
  text: string,
  inMath: boolean,
): SourceMatch[] {
  const found: SourceMatch[] = [];
  for (const source of sources) {
    if (source.where !== "any" && (source.where === "math") !== inMath)
      continue;
    const m = source.pattern.exec(text);
    if (!m || !m[0]) continue;
    const match = m[source.replaceGroup ?? 0] ?? "";
    if (!match) continue;
    const query = m.length > 1 ? (m[m.length - 1] ?? "") : m[0];
    found.push({ source, match, query });
  }
  const kept = found.filter(
    (f) =>
      !f.source.fallback ||
      !found.some(
        (o) => !isCore(o.source) && o.match.length === f.match.length,
      ),
  );
  // Array.prototype.sort is stable: equal groups keep registration order.
  return kept.sort(compareMatches);
}

/** One source's answer so far. */
export interface Group {
  match: SourceMatch;
  /** Where its match starts in the document. */
  from: number;
  /** Asked and not answered yet. */
  pending: boolean;
  /** A whole list the panel filters itself. */
  list: PreparedList<PanelItem> | null;
  /** A list the provider filtered, shown as given. */
  items: PanelItem[];
}

export type PanelRow =
  | { kind: "heading"; title: string }
  | { kind: "item"; item: PanelItem; group: Group }
  | { kind: "loading" };

/** Rows of each group when several have some, and of a lone group. */
export const SHARED_ROWS = 8;
export const LONE_ROWS = 50;

function rowsOf(group: Group, limit: number): PanelItem[] {
  return group.list
    ? rankList(group.list, group.match.query, limit)
    : group.items.slice(0, limit);
}

/** The groups' rows in order, a heading over each while two or more have
 *  rows, and "…" at the end while nothing has rows but a list is coming. */
export function panelRows(groups: readonly Group[]): PanelRow[] {
  const found = groups
    .map((group) => ({ group, items: rowsOf(group, LONE_ROWS) }))
    .filter((g) => g.items.length > 0);
  if (!found.length)
    return groups.some((g) => g.pending) ? [{ kind: "loading" }] : [];
  const shared = found.length > 1;
  const rows: PanelRow[] = [];
  for (const { group, items } of found) {
    if (shared)
      rows.push({ kind: "heading", title: group.match.source.title() });
    for (const item of shared ? items.slice(0, SHARED_ROWS) : items)
      rows.push({ kind: "item", item, group });
  }
  return rows;
}

/** After an arrow key the rows stay put: a group answering late goes
 *  under them, with its heading, and nothing above moves. */
export function appendLate(rows: readonly PanelRow[], late: Group): PanelRow[] {
  const items = rowsOf(late, SHARED_ROWS);
  if (!items.length) return [...rows];
  const kept = rows.filter((r) => r.kind !== "loading");
  return [
    ...kept,
    { kind: "heading", title: late.match.source.title() },
    ...items.map((item) => ({ kind: "item" as const, item, group: late })),
  ];
}

/** The next row that is an item, from `from` by `by` (±1), wrapping. */
export function nextItem(rows: readonly PanelRow[], from: number, by: number) {
  const count = rows.length;
  for (let step = 1; step <= count; step++) {
    const i = (((from + by * step) % count) + count) % count;
    if (rows[i].kind === "item") return i;
  }
  return -1;
}

export function firstItem(rows: readonly PanelRow[]): number {
  return rows.findIndex((r) => r.kind === "item");
}
