import {
  paneBeside,
  paneById,
  paneWithTab,
  panesOf,
  type LayoutNode,
  type Path,
  type SplitDirection,
} from "./tree";
import {
  arrange,
  asRoot,
  focusOn,
  isSplit,
  moveTab,
  oneIsland,
  reorderTab,
  splitOff,
  type Arrival,
  type SplitLayout,
  type SplitRequest,
} from "./ops";
import {
  askGiveWay,
  layoutFits,
  refusal,
  type NoRoom,
} from "../frame/frame-store";
import { resolveSplit } from "./resolve";
import { createSubscribers } from "../../utils/store";

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
  /** A page that is not a document (an AI conversation, Settings, a
   *  plugin's page). */
  view?: unknown;
}

let records: readonly TabRecord[] = [];
let active = "";
/** Tabs in use before, the latest last: a closed one's place goes back. */
let shown: string[] = [];
/** The document in front: the tab in use when it is a document, else the
 *  one last in use - with a conversation or a page in front, the document
 *  the AI reads and writes. */
let documentId = "";
/** A blank tab: for a split asked for with no other tab to take, and for a
 *  change that would leave the window none. */
let blankTab: (() => TabRecord) | null = null;
/** Its islands: one, a branch of one pane, when the window is unsplit. */
let layout: SplitLayout = oneIsland([], null);
let request: SplitRequest | null = null;
let preview: SplitLayout | null = null;
const arriving = new Map<string, Arrival>();
const split = createSubscribers();
const publish = split.publish;
export const subscribeSplit = split.subscribe;

/** The window's first tabs, and how it makes a blank one; once. */
export function startWindowTabs<T extends TabRecord>(
  first: readonly T[],
  blank: () => T,
): void {
  if (records.length) return;
  records = first;
  active = first[0]?.id ?? "";
  blankTab = blank;
  settle();
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
  // Never none: what draws the window reads the tab in use, so a change
  // taking every tab at once (the AI's put away together with no document
  // left) keeps the window's blank one rather than leaving nothing.
  records = next.length || !blankTab ? next : [blankTab()];
  change();
}

/** Tab `id` in use: in front of its island, that island in use. */
export function activateTab(id: string): void {
  if (id === active) return;
  if (active) shown = [...shown.filter((t) => t !== active), active].slice(-32);
  active = id;
  change();
}

/** The window's islands, unsplit or split. */
export function windowLayout(): SplitLayout {
  return layout;
}

/** The islands when there is more than one, else null. */
export function splitLayout(): SplitLayout | null {
  return isSplit(layout) ? layout : null;
}

/** A drop in progress, shown before it is made: drawn in the committed
 *  layout's place (useIslands) and never stored, so letting go of the
 *  drag elsewhere, or Escape, leaves the layout as it was. */
export function splitPreview(): SplitLayout | null {
  return preview;
}

export function previewSplit(next: SplitLayout | null): void {
  if (preview === next) return;
  preview = next;
  publish();
}

/** Island `paneId` (null: the window's first) as it is drawn - a drag's
 *  preview, else the layout: its tabs in order and the one in front. */
export function shownIsland(
  paneId: string | null,
): { tabs: readonly string[]; front: string | null } | null {
  const shown = preview ?? layout;
  const pane =
    paneId === null
      ? panesOf(shown.root)[0]
      : panesOf(shown.root).find((p) => p.id === paneId);
  return pane ? { tabs: pane.tabs, front: pane.front } : null;
}

/** The id of the island `tabId` is in, or null when in none. */
export function paneOf(current: SplitLayout, tabId: string): string | null {
  return paneWithTab(current.root, tabId)?.id ?? null;
}

/** `next`, a layout a split asked for, when its islands fit the window at
 *  their least - the panels' islands folded and the sidebar aside if need
 *  be; null when even so they don't. Every split a person or a plugin
 *  asks for goes through it; a panel folded for room coming back doesn't. */
export function ifRoom(next: SplitLayout | null): SplitLayout | null {
  return withRoom(next).next;
}

/** ifRoom, and whether `next` was refused for want of room - said to the
 *  person (sayNoRoom) - rather than there being nothing to do. */
export function withRoom(next: SplitLayout | null): {
  next: SplitLayout | null;
  noRoom: NoRoom;
} {
  if (!next) return { next: null, noRoom: false };
  const { noRoom } = refusal(next.root, made(next.root));
  return { next: noRoom ? null : next, noRoom };
}

/** `next`, a panel's island (the AI's, a plugin's page) opening beside,
 *  when it fits the window as it is; null and it joins an island instead,
 *  nothing put away for it. */
export function ifFits(next: SplitLayout | null): SplitLayout | null {
  return next && layoutFits(next.root) ? next : null;
}

/** The islands `root` has that the window's layout doesn't, as they are:
 *  new ones, and those whose tabs changed. */
const made = (root: LayoutNode) => madeSince(layout.root, root);

/** Splits the pane in use (or the window) this way, a document of its
 *  tabs, or a blank one, going into the new pane - when the islands, the
 *  new one too, fit the window at their least once the panels and the
 *  sidebar give way: false. Else why not, nothing changed. */
export function splitEditor(direction: SplitDirection): NoRoom {
  const next = resolveSplit(
    layout,
    { direction },
    records.map((tab) => tab.id),
    active,
    () => undefined,
  );
  const root = "blank" in next ? next.blank.root : next.root;
  const { noRoom } = refusal(root, made(root));
  if (noRoom) return noRoom;
  request = { direction };
  change();
  return false;
}

/** A layout an operation (ops.ts) gave back: null, one pane left,
 *  ends the split. */
function commit(next: SplitLayout | null) {
  if (next) setSplitLayout(next);
  else closeSplit();
}

/** A pane's tab bar reordered: `tabId` to `index` among its tabs. */
export function reorderInPane(id: string, tabId: string, index: number): void {
  commit(reorderTab(layout, id, tabId, index));
}

/** A pane's tabs put in the order `ids` gives them, at once (those it
 *  doesn't name after them): a restored window's order. */
export function setTabOrder(id: string, ids: readonly string[]): void {
  let next: SplitLayout | null = layout;
  ids.forEach((tabId, i) => {
    next = next && reorderTab(next, id, tabId, i);
  });
  if (next && next !== layout) commit(next);
}

/** The pane a tab opened next joins. */
export function focusPane(id: string): void {
  setSplitLayout(focusOn(layout, id));
}

/** Opening `tabId` beside `from`: into the island to its right (or below,
 *  on `bottom`) if there is one, else a new island there - beside the
 *  whole window, taking `share` of it, when it is unsplit. */
function besidePlan(
  layout: SplitLayout,
  tabId: string,
  from: string | null,
  side: "right" | "bottom",
  share: number,
): { into: SplitLayout | null } | { split: SplitLayout | null } | null {
  if (!from || from === tabId) return null;
  const home = paneWithTab(layout.root, from);
  if (!home) return null;
  if (!isSplit(layout))
    return { split: splitOff(layout, tabId, null, side, share) };
  const next = paneBeside(layout.root, home.id, side);
  return next
    ? { into: moveTab(layout, tabId, next.id) }
    : { split: splitOff(layout, tabId, home.id, side) };
}

/** `layout` with `tabId` beside `from` (besidePlan), a new island only
 *  when there is room for it (withRoom); `next` null when there is
 *  nothing to do. */
export function besideLayout(
  layout: SplitLayout,
  tabId: string,
  from: string | null,
  side: "right" | "bottom" = "right",
  share = 0.5,
): { next: SplitLayout | null; noRoom: NoRoom } {
  const plan = besidePlan(layout, tabId, from, side, share);
  if (!plan) return { next: null, noRoom: false };
  return "into" in plan
    ? { next: plan.into, noRoom: false }
    : withRoom(plan.split);
}

/** Shows `tabId` beside `from` (besideLayout), both tabs of the window;
 *  why not when the window has no room for it, else false. */
export function openBeside(
  tabId: string,
  from: string | null,
  side: "right" | "bottom" = "right",
  share = 0.5,
): NoRoom {
  const { next, noRoom } = besideLayout(layout, tabId, from, side, share);
  if (next) setSplitLayout(next);
  return noRoom;
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
  commit(arrange(layout, path, change));
}

/** Back to one island: every tab in the window's order, the one in use in
 *  front, in the island it was in (so that island stays as it is drawn). */
export function closeSplit(): void {
  request = null;
  if (!isSplit(layout)) return;
  const home = paneWithTab(layout.root, active) ?? panesOf(layout.root)[0];
  const only = {
    ...home,
    tabs: records.map((tab) => tab.id),
    front: active || null,
  };
  layout = { root: asRoot(only), focus: only.id };
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

let islandCount = 1;

/** Settles the model after any change, then tells its readers. A new
 *  island in too little room - a split, a drop, the AI or a plugin's page
 *  beside - has the panels and the sidebar give way, as ifRoom counted on. */
function change() {
  settle();
  const count = panesOf(layout.root).length;
  if (count > islandCount && !layoutFits(layout.root))
    askGiveWay(madeSince(published, layout.root));
  islandCount = count;
  published = layout.root;
  publish();
}

/** The layout as the window was last told it. */
let published: LayoutNode = layout.root;

/** The islands `root` has that `was` doesn't, as they are. */
function madeSince(was: LayoutNode, root: LayoutNode): ReadonlySet<string> {
  const tabs = new Map(panesOf(was).map((p) => [p.id, p.tabs.join()]));
  return new Set(
    panesOf(root)
      .filter((p) => tabs.get(p.id) !== p.tabs.join())
      .map((p) => p.id),
  );
}

/** The layout as the tabs now stand (resolve.ts): a tab opened joins the
 *  island in use, a closed one leaves its island, the tab in use shows in
 *  front of its own; a split asked for takes a tab or a blank one. Then
 *  the tab in use is one the window has, and the window's order the
 *  islands'. */
function settle() {
  const ids = records.map((tab) => tab.id);
  shown = shown.filter((id) => ids.includes(id));
  const resolved = resolveSplit(
    layout,
    request,
    ids,
    active,
    (id) => arriving.get(id),
    shown,
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
  records = inIslandOrder(records, layout);
  const isDocument = (id: string) =>
    records.some((tab) => tab.id === id && !tab.view);
  if (isDocument(active)) documentId = active;
  else if (!isDocument(documentId))
    documentId = records.find((tab) => !tab.view)?.id ?? active;
}

/** The window's document in front (see `documentId`). */
export function documentInFront(): string {
  return documentId;
}

/** When the tab in use went without another chosen (the AI's tabs put
 *  away together): the first island's front tab, else the last - never
 *  none, or keys and zoom have nowhere to go. */
function fallback(ids: readonly string[]): string {
  // The island it was in first, which shows the tab shown before it.
  const panes = panesOf(layout.root);
  const fronts = [
    paneById(layout.root, layout.focus)?.front,
    ...panes.map((p) => p.front),
  ];
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
  shown = [];
  documentId = "";
  blankTab = null;
  layout = oneIsland([], null);
  islandCount = 1;
  request = null;
  preview = null;
  arriving.clear();
}
