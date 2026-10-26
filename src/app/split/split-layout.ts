/**
 * The window's editor layout: one document, or two in a row or column. Kept
 * outside React so the plugin broker and menus reach it.
 */

export type SplitDirection = "row" | "column";

export interface SplitLayout {
  direction: SplitDirection;
  /** The two tabs shown, first (left or top) and second. The second is
   *  briefly null while a blank tab opens to take the place. */
  panes: [string, string | null];
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
 * Shows `tabId` beside `from`: splitting the window if it isn't, or in the
 * other pane if it is. Call once both tabs are in the window's tabs.
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
