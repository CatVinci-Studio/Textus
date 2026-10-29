import {
  mapPanes,
  pane,
  paneBeside,
  paneById,
  panesOf,
  paneWithTab,
  resizeAt,
  splitPane,
  swapAt,
  tidy,
  turnAt,
  type Branch,
  type Path,
  type SplitDirection,
} from "./split-tree";

/**
 * The window's editor layout: one document, or panes split in rows and
 * columns, nested as far as wanted (split-tree.ts), each with its own tabs.
 * Kept outside React so the plugin broker and menus reach it.
 */

export type { SplitDirection } from "./split-tree";

export interface SplitLayout {
  /** Always a branch: one pane is no split. */
  root: Branch;
  /** The pane in use, by id: a tab opened now joins it. */
  focus: string;
}

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

/** The layout changed through `change`, tidied: a pane left without tabs
 *  goes, and one pane left ends the split. */
function rearrange(change: (root: Branch) => Branch["children"][number]) {
  if (!layout) return;
  const root = tidy(change(layout.root));
  if (!root || root.kind === "pane") {
    closeSplit();
    return;
  }
  const focus = paneById(root, layout.focus)
    ? layout.focus
    : panesOf(root)[0].id;
  setSplitLayout({ root, focus });
}

/** Moves `tabId` into pane `id`, in front there. */
export function moveToPane(tabId: string, id: string): void {
  rearrange(
    (root) =>
      mapPanes(root, (p) => {
        const tabs = p.tabs.filter((t) => t !== tabId);
        if (p.id === id) return { ...p, tabs: [...tabs, tabId], front: tabId };
        return {
          ...p,
          tabs,
          front: p.front === tabId ? (tabs[0] ?? null) : p.front,
        };
      }) as Branch,
  );
  if (layout && paneById(layout.root, id)) focusPane(id);
}

/** A pane's tab bar reordered: `tabId` to `index` among its tabs. */
export function reorderInPane(id: string, tabId: string, index: number): void {
  rearrange(
    (root) =>
      mapPanes(root, (p) => {
        if (p.id !== id) return p;
        const tabs = p.tabs.filter((t) => t !== tabId);
        tabs.splice(index, 0, tabId);
        return { ...p, tabs };
      }) as Branch,
  );
}

/** `tabId` taken from its pane into a new one on `side` of pane `id`. */
export function splitBeside(
  tabId: string,
  id: string,
  side: "left" | "right" | "top" | "bottom",
): void {
  if (!layout) return;
  const added = pane([tabId]);
  const without = mapPanes(layout.root, (p) => {
    const tabs = p.tabs.filter((t) => t !== tabId);
    return {
      ...p,
      tabs,
      front: p.front === tabId ? (tabs[0] ?? null) : p.front,
    };
  });
  const root = tidy(splitPane(without, id, side, added));
  if (!root || root.kind === "pane") return;
  setSplitLayout({ root, focus: added.id });
}

/** The pane a tab opened next joins. */
export function focusPane(id: string): void {
  if (layout && layout.focus !== id && paneById(layout.root, id))
    setSplitLayout({ ...layout, focus: id });
}

/**
 * Shows `tabId` beside `from`: in the pane to its right if there is one,
 * else in a new pane there; splitting the window when it isn't. Call once
 * both tabs are in the window's tabs.
 */
export function openBeside(tabId: string, from: string | null): void {
  if (!from || from === tabId) return;
  const home = layout && paneWithTab(layout.root, from);
  if (!layout || !home) {
    setSplitLayout(pairLayout("row", from, tabId, 1));
    return;
  }
  const right = paneBeside(layout.root, home.id, "right");
  if (right) moveToPane(tabId, right.id);
  else splitBeside(tabId, home.id, "right");
}

/** A branch rearranged: turned the other way, or the two children either
 *  side of boundary `index` swapped, or that boundary moved to `share` of
 *  the two (0.5 evens them). */
export function arrangeBranch(
  path: Path,
  change: "turn" | { swap: number } | { index: number; share: number },
): void {
  rearrange(
    (root) =>
      (change === "turn"
        ? turnAt(root, path)
        : "swap" in change
          ? swapAt(root, path, change.swap)
          : resizeAt(root, path, change.index, change.share)) as Branch,
  );
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
