import {
  keepsItself,
  shareOf,
  mapPanes,
  pane,
  paneById,
  panesOf,
  resizeAt,
  splitPane,
  splitWhole,
  tidy,
  type Branch,
  type LayoutNode,
  type Path,
  type Side,
  type SplitDirection,
} from "./tree";

/**
 * Everything that rearranges a window's islands, as pure functions: a
 * layout in, the layout after out - one island is a layout too (a branch
 * of one pane); null only when no island is left. The menus, the keys and every drag call these and commit
 * what comes back (store.ts); a drag in progress shows it first, as
 * a preview. Any island takes any of the window's tabs.
 */

export interface SplitLayout {
  /** Always a branch: one pane, a branch of one, is the window unsplit. */
  root: Branch;
  /** The pane in use, by id: a tab opened now joins it. */
  focus: string;
}

/** A split asked for, resolved against the window's tabs: the pane in use
 *  split this way. */
export interface SplitRequest {
  direction: SplitDirection;
}

/** Where a tab not yet among the window's goes once it is: asked for as it
 *  is opened (beside, on a side it was dropped on, the AI's island), and
 *  taken by the layout as the tab arrives, so it is never drawn first in
 *  the pane in use. */
export type Arrival = (layout: SplitLayout) => SplitLayout | null;

/** The share of the space a pane may take at least, in a pair. */
const MIN_RATIO = 0.2;

const clampRatio = (ratio: number) =>
  Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio));

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

/** `node` as a layout's root: one pane is a branch of one. */
export function asRoot(node: LayoutNode): Branch {
  return node.kind === "pane"
    ? { kind: "split", direction: "row", children: [node], sizes: [1] }
    : node;
}

/** Whether a layout has more than one island. */
export function isSplit(layout: SplitLayout): boolean {
  return layout.root.children.length > 1;
}

/** The layout after `root` changed: tidied, the focus kept on a pane
 *  still there; null when no pane is left. */
function settled(root: LayoutNode, focus: string): SplitLayout | null {
  const left = tidy(root);
  if (!left) return null;
  const kept = paneById(left, focus);
  return {
    root: asRoot(left),
    focus: kept ? focus : panesOf(left)[0].id,
  };
}

/** The tree with `tabId` out of whichever pane holds it. */
function withoutTab(root: LayoutNode, tabId: string): LayoutNode {
  return mapPanes(root, (p) => {
    if (!p.tabs.includes(tabId)) return p;
    const tabs = p.tabs.filter((t) => t !== tabId);
    return {
      ...p,
      tabs,
      front: p.front === tabId ? (tabs[0] ?? null) : p.front,
    };
  });
}

/** `tabId` into pane `id`, at `index` among its tabs (the end by
 *  default), in front there; that pane in use. */
export function moveTab(
  layout: SplitLayout,
  tabId: string,
  id: string,
  index?: number,
): SplitLayout | null {
  if (!paneById(layout.root, id)) return layout;
  const root = mapPanes(withoutTab(layout.root, tabId), (p) => {
    if (p.id !== id) return p;
    const tabs = [...p.tabs];
    tabs.splice(index ?? tabs.length, 0, tabId);
    return { ...p, tabs, front: tabId };
  });
  return settled(root, id);
}

/** A pane's row reordered: `tabId` to `index` among its tabs. */
export function reorderTab(
  layout: SplitLayout,
  id: string,
  tabId: string,
  index: number,
): SplitLayout | null {
  const root = mapPanes(layout.root, (p) => {
    if (p.id !== id || !p.tabs.includes(tabId)) return p;
    const tabs = p.tabs.filter((t) => t !== tabId);
    tabs.splice(index, 0, tabId);
    return { ...p, tabs };
  });
  return settled(root, layout.focus);
}

/** `tabId` out of its pane into a new one on `side` of pane `id` - or of
 *  the whole layout, with `id` null, taking `share` of it - that one in
 *  use. */
export function splitOff(
  layout: SplitLayout,
  tabId: string,
  id: string | null,
  side: Side,
  share?: number,
): SplitLayout | null {
  const added = pane([tabId]);
  const without = withoutTab(layout.root, tabId);
  const root =
    id === null
      ? splitWhole(without, side, added, share)
      : splitPane(without, id, side, added);
  return settled(root, added.id);
}

/** Pane `id`, tabs and all, moved to `side` of pane `target` - or of the
 *  whole layout, with `target` null. */
export function movePane(
  layout: SplitLayout,
  id: string,
  target: string | null,
  side: Side,
): SplitLayout | null {
  const moved = paneById(layout.root, id);
  if (!moved || id === target) return layout;
  const rest = tidy(layout.root, (p) => p.id !== id && keepsItself(p));
  if (!rest) return layout;
  // Moved to the layout's edge the same way it ran, it keeps its width
  // (or height): an island docked left is as wide as it was.
  const was = shareOf(layout.root, id);
  const across = side === "left" || side === "right" ? "row" : "column";
  const root =
    target === null
      ? splitWhole(
          rest,
          side,
          moved,
          was?.direction === across ? was.share : undefined,
        )
      : splitPane(rest, target, side, moved);
  return settled(root, id);
}

/** A branch's boundary `index` moved to `share` of the two children
 *  either side of it (0.5 evens them). */
export function arrange(
  layout: SplitLayout,
  path: Path,
  change: { index: number; share: number },
): SplitLayout | null {
  return settled(
    resizeAt(layout.root, path, change.index, change.share),
    layout.focus,
  );
}

/** Pane `id` in use: a tab opened next joins it. Only documents' panes
 *  take that. */
export function focusOn(layout: SplitLayout, id: string): SplitLayout {
  return layout.focus === id || !paneById(layout.root, id)
    ? layout
    : { ...layout, focus: id };
}

/** One island of `tabIds`, `front` in front: a window unsplit. */
export function oneIsland(
  tabIds: readonly string[],
  front: string | null,
): SplitLayout {
  const only = { ...pane([...tabIds]), front };
  return { root: asRoot(only), focus: only.id };
}

/** A drag's preview once the tab has left its place: `tabId` out of its
 *  island, the island gone if that was all it held. Never stored. */
export function lifted(layout: SplitLayout, tabId: string): SplitLayout {
  const left = tidy(withoutTab(layout.root, tabId), keepsItself);
  if (!left) return layout;
  return { root: asRoot(left), focus: layout.focus };
}

/** A drag's preview of `tabId` joining pane `id` at `index`: its place
 *  closed, a slot opened there, what that pane shows unchanged. One island
 *  left is spelt out as one. Never stored. */
export function joined(
  layout: SplitLayout,
  tabId: string,
  id: string,
  index: number,
): SplitLayout {
  const root = mapPanes(withoutTab(layout.root, tabId), (p) => {
    if (p.id !== id) return p;
    const tabs = [...p.tabs];
    tabs.splice(Math.min(index, tabs.length), 0, tabId);
    return { ...p, tabs };
  });
  const left = tidy(root, keepsItself);
  if (!left) return layout;
  return { root: asRoot(left), focus: layout.focus };
}
