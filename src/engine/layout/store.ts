import {
  pane,
  paneBeside,
  paneWithTab,
  type Path,
  type Side,
  type SplitDirection,
} from "./tree";
import {
  arrange,
  focusOn,
  moveTab,
  reorderTab,
  splitOff,
  type SplitLayout,
} from "./ops";

/**
 * The window's editor layout: one document, or panes split in rows and
 * columns, nested as far as wanted (tree.ts), each with its own tabs.
 * Kept outside React so the plugin broker and menus reach it.
 */

export type { SplitDirection } from "./tree";

export type { SplitLayout } from "./ops";

/** A split asked for, resolved against the window's tabs: the pane in use
 *  split this way. */
export interface SplitRequest {
  direction: SplitDirection;
}

let layout: SplitLayout | null = null;
let request: SplitRequest | null = null;
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

export function splitLayout(): SplitLayout | null {
  return layout;
}

export function splitRequest(): SplitRequest | null {
  return request;
}

let preview: SplitLayout | null = null;

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

/** Two panes, one tab each (the second may be on its way: null), the
 *  first's share `ratio`; `focus` is the pane in use. */
export function pairLayout(
  direction: SplitDirection,
  first: string,
  second: string | null,
  focus: 0 | 1 = 0,
  ratio = 0.5,
): SplitLayout {
  const panes = [pane([first]), pane(second ? [second] : [], second)];
  return {
    root: {
      kind: "split",
      direction,
      children: panes,
      sizes: [clampRatio(ratio), 1 - clampRatio(ratio)],
    },
    focus: panes[focus].id,
  };
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
  publish();
}

/** A layout an operation (ops.ts) gave back: null, one pane left,
 *  ends the split. */
function commit(next: SplitLayout | null) {
  if (next) setSplitLayout(next);
  else closeSplit();
}

/** Moves `tabId` into pane `id`, in front there. */
export function moveToPane(tabId: string, id: string): void {
  if (layout) commit(moveTab(layout, tabId, id));
}

/** A pane's tab bar reordered: `tabId` to `index` among its tabs. */
export function reorderInPane(id: string, tabId: string, index: number): void {
  if (layout) commit(reorderTab(layout, id, tabId, index));
}

/** `tabId` taken from its pane into a new one on `side` of pane `id`; a
 *  pane's only tab stays where it is. */
export function splitBeside(tabId: string, id: string, side: Side): void {
  const next = layout && splitOff(layout, tabId, id, side);
  if (next) setSplitLayout(next);
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

/** Where a tab not yet among the window's goes once it is: asked for as it
 *  is opened (beside, on a side it was dropped on, the AI's island), and
 *  taken by the layout as the tab arrives, so it is never drawn first in
 *  the pane in use. */
export type Arrival = (layout: SplitLayout | null) => SplitLayout | null;
const arriving = new Map<string, Arrival>();

export function placeOnArrival(tabId: string, place: Arrival): void {
  arriving.set(tabId, place);
}

export function arrivalOf(tabId: string): Arrival | undefined {
  return arriving.get(tabId);
}

/** The window's tabs settled: a place asked for a tab now among them has
 *  been taken (or it went where it could), whatever the layout became. */
export function arrivalsTaken(tabIds: readonly string[]): void {
  for (const id of tabIds) arriving.delete(id);
}

/** A branch rearranged: turned the other way, or the two children either
 *  side of boundary `index` swapped, or that boundary moved to `share` of
 *  the two (0.5 evens them). */
export function arrangeBranch(
  path: Path,
  change: "turn" | { swap: number } | { index: number; share: number },
): void {
  if (layout) commit(arrange(layout, path, change));
}

/** Back to one document: the one in front. */
export function closeSplit(): void {
  request = null;
  setSplitLayout(null);
}

export function setSplitLayout(next: SplitLayout | null): void {
  if (next) request = null;
  if (next === layout) return;
  layout = next;
  publish();
}

/** The share of the space a pane may take at least, in a pair. */
export const MIN_RATIO = 0.2;

export function clampRatio(ratio: number): number {
  return Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio));
}
