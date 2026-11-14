import { moveTab, splitOff, type SplitLayout } from "./ops";
import {
  mapPanes,
  panesOf,
  type Branch,
  type LayoutNode,
  type Pane,
  type Side,
} from "./tree";

/** An island folded into its neighbour's: enough to put it back. */
export interface Folded {
  /** The island's own id, which it takes back: a fold stacked on it names it. */
  id: string;
  tabs: string[];
  front: string | null;
  /** The island it joined, what that showed, and the side it stood on. */
  into: string;
  intoFront: string | null;
  side: Side;
  /** The width the islands needed before it folded. */
  need: number;
}

/** Only along a row: an island folded into the one above or below frees no
 *  width, a column being as wide as its widest. */
const SIDES: Side[] = ["left", "right"];
/** Of the sides a panel stands on, the side its neighbour is on. */
const OPPOSITE: Record<Side, Side> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};

/**
 * The window short of room: the last panel's island (the AI, Settings, a
 * plugin's page) folded into the island beside it, its tabs joining that
 * row; with no panel left, the last document's island, so a split that
 * can't fit comes undone. The island in use keeps showing what it showed.
 * Null when no island stands beside another in a row.
 */
export function foldIsland(
  layout: SplitLayout,
  isPanel: (pane: Pane) => boolean,
  need: number,
): { layout: SplitLayout; folded: Folded } | null {
  const panes = [...panesOf(layout.root)].reverse();
  const order = [...panes.filter(isPanel), ...panes.filter((p) => !isPanel(p))];
  for (const panel of order) {
    for (const side of SIDES) {
      const into = rowNeighbour(layout.root, panel.id, side);
      if (!into) continue;
      let next: SplitLayout | null = layout;
      for (const tab of panel.tabs) next = next && moveTab(next, tab, into.id);
      if (!next) return null;
      const inUse = layout.focus === panel.id;
      next = {
        ...next,
        root: withFront(next.root, into.id, inUse ? panel.front : into.front),
        focus: inUse ? into.id : layout.focus,
      };
      return {
        layout: next,
        folded: {
          id: panel.id,
          tabs: [...panel.tabs],
          front: panel.front,
          into: into.id,
          intoFront: into.front,
          side: OPPOSITE[side],
          need,
        },
      };
    }
  }
  return null;
}

/** A folded island back on its side of the island it joined, under its own
 *  id, with the tabs it had that are still open; null when none are or that
 *  island is gone. What the user picked meanwhile stays: a moved tab in
 *  front of the neighbour comes back in front, and in use if that was. */
export function unfoldIsland(
  layout: SplitLayout,
  folded: Folded,
): SplitLayout | null {
  const into = panesOf(layout.root).find((p) => p.id === folded.into);
  const tabs = folded.tabs.filter((t) => into?.tabs.includes(t));
  if (!into || !tabs.length || tabs.length === into.tabs.length) return null;
  let next = splitOff(layout, tabs[0], into.id, folded.side);
  const added = next && panesOf(next.root).find((p) => p.tabs[0] === tabs[0]);
  if (!next || !added) return null;
  for (const tab of tabs.slice(1)) next = next && moveTab(next, tab, added.id);
  if (!next) return null;
  const taken = panesOf(next.root).some((p) => p.id === folded.id);
  const id = taken ? added.id : folded.id;
  const root = taken
    ? next.root
    : (mapPanes(next.root, (p) =>
        p.id === added.id ? { ...p, id } : p,
      ) as Branch);
  const picked = into.front && tabs.includes(into.front) ? into.front : null;
  const front =
    picked ??
    (folded.front && tabs.includes(folded.front) ? folded.front : tabs[0]);
  const intoFront = picked ? folded.intoFront : into.front;
  return {
    ...next,
    root: withFront(withFront(root, id, front), into.id, intoFront),
    focus: picked && layout.focus === into.id ? id : layout.focus,
  };
}

/** The island right beside pane `id` in the row they share, itself a pane:
 *  folded into one inside a column, it would come back in that column, the
 *  layout's shape changed. */
function rowNeighbour(
  node: LayoutNode,
  id: string,
  side: Side,
): Pane | undefined {
  if (node.kind === "pane") return undefined;
  const at = node.children.findIndex((c) => c.kind === "pane" && c.id === id);
  if (at >= 0) {
    const next = node.children[at + (side === "left" ? -1 : 1)];
    return node.direction === "row" && next?.kind === "pane" ? next : undefined;
  }
  for (const child of node.children) {
    const found = rowNeighbour(child, id, side);
    if (found) return found;
  }
  return undefined;
}

/** Pane `id` showing `front`, when it holds it. */
function withFront(root: Branch, id: string, front: string | null): Branch {
  return mapPanes(root, (p) =>
    p.id === id && front && p.tabs.includes(front) ? { ...p, front } : p,
  ) as Branch;
}
