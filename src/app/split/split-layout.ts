/**
 * The window's editor layout: one document, or two panes in a row or
 * column, each with its own tabs. Kept outside React so the plugin broker
 * and menus reach it.
 */

export type SplitDirection = "row" | "column";

export type PaneIndex = 0 | 1;

export interface SplitLayout {
  direction: SplitDirection;
  /** The tab each pane shows, first (left or top) and second. The second
   *  is briefly null while a blank tab opens to take the place. */
  panes: [string, string | null];
  /** Each pane's tabs, in its tab bar's order. */
  groups: [string[], string[]];
  /** The pane in use: a tab opened now joins it. */
  focus: PaneIndex;
  /** The first pane's share of the space, 0.2 to 0.8. */
  ratio: number;
}

/** A split asked for, resolved against the window's tabs. */
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

/** Two panes, one tab each; the window's other tabs join `focus`'s. */
export function pairLayout(
  direction: SplitDirection,
  first: string,
  second: string | null,
  focus: PaneIndex = 0,
  ratio = 0.5,
): SplitLayout {
  return {
    direction,
    panes: [first, second],
    groups: [[first], second ? [second] : []],
    focus,
    ratio,
  };
}

/** The pane `tabId` is in, or null when not split or not in either. */
export function paneOf(
  current: SplitLayout | null,
  tabId: string,
): PaneIndex | null {
  if (!current) return null;
  if (current.groups[0].includes(tabId)) return 0;
  if (current.groups[1].includes(tabId)) return 1;
  return null;
}

/** Shows the document in front beside another, in `direction`; already
 *  split, turns the panes that way. */
export function splitEditor(direction: SplitDirection): void {
  if (layout) setSplitLayout({ ...layout, direction });
  else {
    request = { direction };
    publish();
  }
}

/** The panes as they are, rearranged: their sides swapped, and the first
 *  one's share set (clamped). Nothing when not split. */
export function arrangeSplit(change: { swap?: boolean; ratio?: number }): void {
  if (!layout) return;
  const [first, second] = layout.panes;
  const swap = change.swap && second;
  setSplitLayout({
    ...layout,
    panes: swap ? [second, first] : layout.panes,
    groups: swap ? [layout.groups[1], layout.groups[0]] : layout.groups,
    focus: swap ? ((1 - layout.focus) as PaneIndex) : layout.focus,
    ratio: change.ratio === undefined ? layout.ratio : clampRatio(change.ratio),
  });
}

/** Moves `tabId` into `pane`, in front there. */
export function moveToPane(tabId: string, pane: PaneIndex): void {
  if (!layout) return;
  const groups = layout.groups.map((group) =>
    group.filter((id) => id !== tabId),
  ) as [string[], string[]];
  groups[pane].push(tabId);
  const panes = [...layout.panes] as [string, string | null];
  panes[pane] = tabId;
  setSplitLayout({ ...layout, groups, panes, focus: pane });
}

/** A pane's tab bar reordered: `tabId` to `index` among its tabs. */
export function reorderInPane(
  pane: PaneIndex,
  tabId: string,
  index: number,
): void {
  if (!layout) return;
  const group = layout.groups[pane].filter((id) => id !== tabId);
  group.splice(index, 0, tabId);
  const groups = [...layout.groups] as [string[], string[]];
  groups[pane] = group;
  setSplitLayout({ ...layout, groups });
}

/** The pane a tab opened next joins. */
export function focusPane(pane: PaneIndex): void {
  if (layout && layout.focus !== pane) setSplitLayout({ ...layout, focus: pane });
}

/**
 * Shows `tabId` beside `from`: splitting the window if it isn't, or in the
 * other pane if it is. Call once both tabs are in the window's tabs.
 */
export function openBeside(tabId: string, from: string | null): void {
  if (!from || from === tabId) return;
  if (layout?.panes[1]) {
    const side = paneOf(layout, from) ?? 0;
    moveToPane(tabId, (1 - side) as PaneIndex);
    return;
  }
  setSplitLayout(pairLayout("row", from, tabId));
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

/** The share of the space a pane may take at least. */
export const MIN_RATIO = 0.2;

export function clampRatio(ratio: number): number {
  return Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio));
}
