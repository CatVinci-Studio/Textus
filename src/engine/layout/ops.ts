import {
  aiPane,
  islandOf,
  keepsItself,
  shareOf,
  sizeAt,
  mapPanes,
  pane,
  paneById,
  panesOf,
  resizeAt,
  splitPane,
  splitWhole,
  swapAt,
  tidy,
  turnAt,
  type Branch,
  type LayoutNode,
  type Pane,
  type Path,
  type Side,
} from "./tree";

/**
 * Everything that rearranges a window's islands, as pure functions: a
 * layout in, the layout after out - null when one island of documents is
 * left (no split). The menus, the keys and every drag call these and commit
 * what comes back (store.ts); a drag in progress shows it first, as
 * a preview. An island takes only its kind's tabs: documents' panes the
 * window's tabs, the AI island none of them (its tabs are the folder's
 * conversations).
 */

export interface SplitLayout {
  /** Always a branch: one pane is no split. */
  root: Branch;
  /** The pane in use, by id: a tab opened now joins it. */
  focus: string;
}

/** The layout after `root` changed: tidied, the focus kept on a pane of
 *  documents that is still there; null when one pane is left. */
function settled(root: LayoutNode, focus: string): SplitLayout | null {
  const left = tidy(root);
  if (!left || left.kind === "pane") return null;
  const kept = paneById(left, focus);
  return {
    root: left,
    focus:
      kept && islandOf(kept) === "documents" ? focus : firstDocuments(left).id,
  };
}

function firstDocuments(root: LayoutNode): Pane {
  const panes = panesOf(root);
  return panes.find((p) => islandOf(p) === "documents") ?? panes[0];
}

/** Pane `id` takes document tabs. */
function takesDocuments(root: LayoutNode, id: string): boolean {
  const p = paneById(root, id);
  return !!p && islandOf(p) === "documents";
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
  if (!takesDocuments(layout.root, id)) return layout;
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
  // (or height): the AI island docked left is as wide as it was.
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
  return settled(root, islandOf(moved) === "documents" ? id : layout.focus);
}

/** A branch rearranged: turned the other way, the two children either side
 *  of boundary `index` swapped, or that boundary moved to `share` of the
 *  two (0.5 evens them). */
export function arrange(
  layout: SplitLayout,
  path: Path,
  change: "turn" | { swap: number } | { index: number; share: number },
): SplitLayout | null {
  const root =
    change === "turn"
      ? turnAt(layout.root, path)
      : "swap" in change
        ? swapAt(layout.root, path, change.swap)
        : resizeAt(layout.root, path, change.index, change.share);
  return settled(root, layout.focus);
}

/** Pane `id` in use: a tab opened next joins it. Only documents' panes
 *  take that. */
export function focusOn(layout: SplitLayout, id: string): SplitLayout {
  return layout.focus === id || !takesDocuments(layout.root, id)
    ? layout
    : { ...layout, focus: id };
}

/** The AI island open: at the right of everything, `share` of the width,
 *  if it isn't there already. `base` is the layout of documents (null: one
 *  pane of `tabIds`, `active` in front). */
export function withAi(
  base: SplitLayout | null,
  tabIds: readonly string[],
  active: string,
  share: number,
): SplitLayout {
  if (base && panesOf(base.root).some((p) => islandOf(p) === "ai")) return base;
  const docs: LayoutNode = base?.root ?? pane([...tabIds], active);
  const root = splitWhole(docs, "right", aiPane());
  const at = root.sizes.length - 1;
  const rest = 1 - root.sizes[at];
  const sizes = root.sizes.map((size, i) =>
    i === at ? share : (size / rest) * (1 - share),
  );
  return {
    root: { ...root, sizes },
    focus: base?.focus ?? panesOf(docs)[0].id,
  };
}

/** The AI island closed: the documents take its room. */
export function withoutAi(layout: SplitLayout): SplitLayout | null {
  const rest = tidy(layout.root, (p) => islandOf(p) !== "ai" && keepsItself(p));
  return rest ? settled(rest, layout.focus) : null;
}

/** Pane `id` at `share` of its row or column (sizeAt). */
export function sizePane(
  layout: SplitLayout,
  id: string,
  share: number,
): SplitLayout {
  return { ...layout, root: sizeAt(layout.root, id, share) as Branch };
}
