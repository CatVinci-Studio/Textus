import {
  paneBeside,
  paneWithTab,
  panesOf,
  type Path,
  type SplitDirection,
} from "./tree";
import {
  arrange,
  focusOn,
  moveTab,
  pairLayout,
  reorderTab,
  splitOff,
  type Arrival,
  type SplitLayout,
  type SplitRequest,
} from "./ops";
import { resolveSplit } from "./resolve";

/**
 * The window's model, its one owner: the tabs it has, the one in use, and
 * its islands - one document, or panes split in rows and columns, each with
 * its own tabs and the one in front. Every change goes through here and the
 * layout is settled with it, so the tab in use is always its island's
 * front and that island the one in use. Kept outside React so the plugin
 * broker and menus reach it; React and the frame read it.
 */

/** A tab as the model knows it; the window's records are its own. */
interface TabRecord {
  id: string;
}

let records: readonly TabRecord[] = [];
let active = "";
/** A blank tab, for a split asked for with no other tab to take. */
let blankTab: (() => TabRecord) | null = null;
let layout: SplitLayout | null = null;
let request: SplitRequest | null = null;
let preview: SplitLayout | null = null;
const arriving = new Map<string, Arrival>();
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

export function subscribeSplit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The window's first tabs, and how it makes a blank one; once. */
export function startWindowTabs<T extends TabRecord>(
  first: readonly T[],
  blank: () => T,
): void {
  if (records.length) return;
  records = first;
  active = first[0]?.id ?? "";
  blankTab = blank;
}

/** The window's tabs, in its order: the islands' when split. */
export function windowTabs<T extends TabRecord>(): readonly T[] {
  return records as readonly T[];
}

/** The tab in use: its island's front, that island the one in use. */
export function tabInUse(): string {
  return active;
}

/** The window's tabs changed (opened, closed, edited, reordered). */
export function setWindowTabs<T extends TabRecord>(
  update: (prev: readonly T[]) => readonly T[],
): void {
  const next = update(records as readonly T[]);
  if (next === records) return;
  records = next;
  change();
}

/** Tab `id` in use: in front of its island, that island in use. */
export function activateTab(id: string): void {
  if (id === active) return;
  active = id;
  change();
}

export function splitLayout(): SplitLayout | null {
  return layout;
}

export function splitRequest(): SplitRequest | null {
  return request;
}

/** A drop in progress, shown before it is made: drawn in the committed
 *  layout's place (useSplitPanes) and never stored, so letting go of the
 *  drag elsewhere, or Escape, leaves the layout as it was. */
export function splitPreview(): SplitLayout | null {
  return preview;
}

export function previewSplit(next: SplitLayout | null): void {
  if (preview === next) return;
  preview = next;
  publish();
}

/** Island `paneId` (null: the one island unsplit) as it is drawn - a drag's
 *  preview, else the split, else the window's tabs: its tabs in order and
 *  the one in front. */
export function shownIsland(
  paneId: string | null,
): { tabs: readonly string[]; front: string | null } | null {
  const shown = preview ?? layout;
  if (paneId === null)
    return shown ? null : { tabs: records.map((t) => t.id), front: active };
  const pane = shown && panesOf(shown.root).find((p) => p.id === paneId);
  return pane ? { tabs: pane.tabs, front: pane.front } : null;
}

/** The id of the pane `tabId` is in, or null when not split or in none. */
export function paneOf(
  current: SplitLayout | null,
  tabId: string,
): string | null {
  return (current && paneWithTab(current.root, tabId)?.id) ?? null;
}

/** Splits the pane in use (or the window) this way, a document of its
 *  tabs, or a blank one, going into the new pane. */
export function splitEditor(direction: SplitDirection): void {
  request = { direction };
  change();
}

/** A layout an operation (ops.ts) gave back: null, one pane left,
 *  ends the split. */
function commit(next: SplitLayout | null) {
  if (next) setSplitLayout(next);
  else closeSplit();
}

/** A pane's tab bar reordered: `tabId` to `index` among its tabs. */
export function reorderInPane(id: string, tabId: string, index: number): void {
  if (layout) commit(reorderTab(layout, id, tabId, index));
}

/** The pane a tab opened next joins. */
export function focusPane(id: string): void {
  if (layout) setSplitLayout(focusOn(layout, id));
}

/**
 * `layout` with `tabId` beside `from`: in the pane to its right (or below,
 * on `bottom`) if there is one, else in a new pane there; the window split
 * when it isn't. Null when there is nothing to do.
 */
export function besideLayout(
  layout: SplitLayout | null,
  tabId: string,
  from: string | null,
  side: "right" | "bottom" = "right",
  /** The new pane's share of the window, when it splits it (half). */
  share = 0.5,
  /** The window's tabs in their order, when it splits it: they stay on
   *  `from`'s side, `from` in front. */
  windowTabs: readonly string[] = [],
): SplitLayout | null {
  if (!from || from === tabId) return null;
  const home = layout && paneWithTab(layout.root, from);
  if (!layout || !home) {
    const pair = pairLayout(
      side === "right" ? "row" : "column",
      from,
      tabId,
      0,
      1 - share,
    );
    const stay = windowTabs.filter((id) => id !== tabId);
    const [first] = pair.root.kind === "split" ? pair.root.children : [];
    if (first?.kind === "pane" && stay.includes(from)) first.tabs = stay;
    return pair;
  }
  const next = paneBeside(layout.root, home.id, side);
  return next
    ? moveTab(layout, tabId, next.id)
    : splitOff(layout, tabId, home.id, side);
}

/** Shows `tabId` beside `from` (besideLayout), both tabs of the window. */
export function openBeside(
  tabId: string,
  from: string | null,
  side: "right" | "bottom" = "right",
  share = 0.5,
  windowTabs: readonly string[] = [],
): void {
  const next = besideLayout(layout, tabId, from, side, share, windowTabs);
  if (next) setSplitLayout(next);
}

/** Where a tab goes as it arrives (Arrival): asked for before it is
 *  added, taken as it is; asked for one just added, taken now - both in
 *  the same tick, before anything is drawn. */
export function placeOnArrival(tabId: string, place: Arrival): void {
  if (!records.some((tab) => tab.id === tabId)) {
    arriving.set(tabId, place);
    return;
  }
  const next = place(layout);
  if (!next || next === layout) return;
  layout = next;
  change();
}

/** A branch's boundary `index` moved to `share` of the two either side of
 *  it (0.5 evens them): a divider dragged. */
export function arrangeBranch(
  path: Path,
  change: { index: number; share: number },
): void {
  if (layout) commit(arrange(layout, path, change));
}

/** Back to one document: the one in front. */
export function closeSplit(): void {
  request = null;
  if (!layout) return;
  layout = null;
  change();
}

/** A layout made elsewhere (a drop, a restore): the tab in use becomes the
 *  front of its island in use. */
export function setSplitLayout(next: SplitLayout | null): void {
  if (!next) return closeSplit();
  request = null;
  if (next === layout) return;
  layout = next;
  const focus = panesOf(next.root).find((p) => p.id === next.focus);
  if (focus?.front) active = focus.front;
  change();
}

/** Settles the model after any change, then tells its readers. */
function change() {
  settle();
  publish();
}

/** The layout as the tabs now stand (resolve.ts): a tab opened joins the
 *  island in use, a closed one leaves its island, the tab in use shows in
 *  front of its own; a split asked for takes a tab or a blank one. Then
 *  the tab in use is one the window has, and the window's order the
 *  islands'. */
function settle() {
  const ids = records.map((tab) => tab.id);
  const resolved = resolveSplit(layout, request, ids, active, (id) =>
    arriving.get(id),
  );
  if (resolved && "blank" in resolved) {
    layout = resolved.blank;
    request = null;
    const blank = blankTab?.();
    if (!blank) return;
    records = [...records, blank];
    active = blank.id;
    return settle();
  }
  layout = resolved;
  request = null;
  for (const id of ids) arriving.delete(id);
  if (!ids.includes(active)) active = fallback(ids);
  if (layout) records = inIslandOrder(records, layout);
}

/** When the tab in use went without another chosen (the AI's tabs put
 *  away together): the first island's front tab, else the last - never
 *  none, or keys and zoom have nowhere to go. */
function fallback(ids: readonly string[]): string {
  const fronts = layout ? panesOf(layout.root).map((p) => p.front) : [];
  return fronts.find((f) => f && ids.includes(f)) ?? ids[ids.length - 1] ?? "";
}

/** `tabs` in the islands' order, the same array when it already is. */
function inIslandOrder(
  tabs: readonly TabRecord[],
  split: SplitLayout,
): readonly TabRecord[] {
  const order = panesOf(split.root).flatMap((p) => p.tabs);
  const at = new Map(order.map((id, i) => [id, i]));
  const sorted = [...tabs].sort(
    (a, b) => (at.get(a.id) ?? order.length) - (at.get(b.id) ?? order.length),
  );
  return sorted.every((tab, i) => tab === tabs[i]) ? tabs : sorted;
}

/** For tests: a window with no tabs or islands yet. */
export function resetWindowModelForTests(): void {
  records = [];
  active = "";
  blankTab = null;
  layout = null;
  request = null;
  preview = null;
  arriving.clear();
}
