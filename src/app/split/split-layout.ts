import {
  pane,
  paneBeside,
  paneWithTab,
  type Path,
  type Side,
  type SplitDirection,
} from "./split-tree";
import {
  arrange,
  focusOn,
  moveTab,
  reorderTab,
  splitOff,
  type SplitLayout,
} from "./layout-ops";

/**
 * The window's editor layout: one document, or panes split in rows and
 * columns, nested as far as wanted (split-tree.ts), each with its own tabs.
 * Kept outside React so the plugin broker and menus reach it.
 */

export type { SplitDirection } from "./split-tree";

export type { SplitLayout } from "./layout-ops";

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

/** A layout an operation (layout-ops.ts) gave back: null, one pane left,
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

/** `tabId` in a new pane beside the whole layout on `side`. */
export function splitAtEdge(tabId: string, side: Side): void {
  const next = layout && splitOff(layout, tabId, null, side);
  if (next) setSplitLayout(next);
}

/** The pane a tab opened next joins. */
export function focusPane(id: string): void {
  if (layout) setSplitLayout(focusOn(layout, id));
}

/**
 * Shows `tabId` beside `from`: in the pane to its right (or below, on
 * `bottom`) if there is one, else in a new pane there; splitting the window
 * when it isn't. Call once both tabs are in the window's tabs.
 */
export function openBeside(
  tabId: string,
  from: string | null,
  side: "right" | "bottom" = "right",
): void {
  if (!from || from === tabId) return;
  const home = layout && paneWithTab(layout.root, from);
  if (!layout || !home) {
    setSplitLayout(
      pairLayout(side === "right" ? "row" : "column", from, tabId, 1),
    );
    return;
  }
  const next = paneBeside(layout.root, home.id, side);
  if (next) moveToPane(tabId, next.id);
  else splitBeside(tabId, home.id, side);
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
