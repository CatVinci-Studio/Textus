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
} from "./tree";

/**
 * Everything that rearranges a window's islands, as pure functions: a
 * layout in, the layout after out - null when one island is
 * left (no split). The menus, the keys and every drag call these and commit
 * what comes back (store.ts); a drag in progress shows it first, as
 * a preview. Any island takes any of the window's tabs.
 */

export interface SplitLayout {
  /** Always a branch: one pane is no split. */
  root: Branch;
  /** The pane in use, by id: a tab opened now joins it. */
  focus: string;
}

/** The layout after `root` changed: tidied, the focus kept on a pane
 *  still there; null when one pane is left. */
function settled(root: LayoutNode, focus: string): SplitLayout | null {
  const left = tidy(root);
  if (!left || left.kind === "pane") return null;
  const kept = paneById(left, focus);
  return {
    root: left,
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
 *  the whole layout, with `id` null - that one in use. */
export function splitOff(
  layout: SplitLayout,
  tabId: string,
  id: string | null,
  side: Side,
): SplitLayout | null {
  const added = pane([tabId]);
  const without = withoutTab(layout.root, tabId);
  const root =
    id === null
      ? splitWhole(without, side, added)
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

/** One island of `tabIds`, `front` in front, as a layout: what a window
 *  with no split shows, spelt out so a drag's preview can work on it. */
export function oneIsland(
  tabIds: readonly string[],
  front: string | null,
): SplitLayout {
  const only = { ...pane([...tabIds]), front };
  return {
    root: { kind: "split", direction: "row", children: [only], sizes: [1] },
    focus: only.id,
  };
}

/** A drag's preview once the tab has left its place: `tabId` out of its
 *  island, the island gone if that was all it held. Never stored. */
export function lifted(layout: SplitLayout, tabId: string): SplitLayout {
  const left = tidy(withoutTab(layout.root, tabId), keepsItself);
  if (!left) return layout;
  return {
    root:
      left.kind === "pane"
        ? { kind: "split", direction: "row", children: [left], sizes: [1] }
        : left,
    focus: layout.focus,
  };
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
  return {
    root:
      left.kind === "pane"
        ? { kind: "split", direction: "row", children: [left], sizes: [1] }
        : left,
    focus: layout.focus,
  };
}
