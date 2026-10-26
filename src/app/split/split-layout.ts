/**
 * The window's editor layout: one document, or two side by side (a row)
 * or one over the other (a column). The app draws the panes (MainPane,
 * useSplitPanes); what splits them is a plugin's, through the layout API
 * (window.splitEditor in the plugin broker) - kept here, outside React, so
 * the broker and the menus reach it without the window's tree.
 */

export type SplitDirection = "row" | "column";

export interface SplitLayout {
  direction: SplitDirection;
  /** The two tabs shown, first (left or top) and second. The second is
   *  null for a moment when the window had one tab: the blank tab opened
   *  for it takes the place. */
  panes: [string, string | null];
  /** The first pane's share of the space, 0.2 to 0.8. */
  ratio: number;
}

/** A split asked for, resolved against the window's tabs by
 *  useSplitPanes. */
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

/** Shows the document in front beside another, in `direction`; already
 *  split, turns the panes that way. */
export function splitEditor(direction: SplitDirection): void {
  if (layout) setSplitLayout({ ...layout, direction });
  else {
    request = { direction };
    publish();
  }
}

/** The panes as they are, rearranged: their tabs swapped, and the first
 *  one's share set (clamped). Nothing when not split. */
export function arrangeSplit(change: { swap?: boolean; ratio?: number }): void {
  if (!layout) return;
  const [first, second] = layout.panes;
  setSplitLayout({
    ...layout,
    panes: change.swap && second ? [second, first] : layout.panes,
    ratio: change.ratio === undefined ? layout.ratio : clampRatio(change.ratio),
  });
}

/**
 * Shows `tabId` beside `from` (the tab that was in front): splitting the
 * window side by side if it isn't, or in the pane `from` isn't in if it
 * is. Called once both tabs are in the window's tabs - the next frame
 * after a tab is added.
 */
export function openBeside(tabId: string, from: string | null): void {
  if (!from || from === tabId) return;
  const [first, second] = layout?.panes ?? [];
  if (layout && second) {
    const panes: [string, string] =
      first === from
        ? [from, tabId]
        : second === from
          ? [tabId, from]
          : [first ?? from, tabId];
    setSplitLayout({ ...layout, panes });
    return;
  }
  setSplitLayout({ direction: "row", panes: [from, tabId], ratio: 0.5 });
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
