import { moveTab, splitOff, type SplitLayout } from "./ops";
import {
  mapPanes,
  paneBeside,
  panesOf,
  type Branch,
  type Pane,
  type Side,
} from "./tree";

/** A panel's island folded into its neighbour's: enough to put it back. */
export interface Folded {
  tabs: string[];
  front: string | null;
  /** The island it joined, and the side of it it stood on. */
  into: string;
  side: Side;
  /** The width the islands needed before it folded. */
  need: number;
}

const SIDES: Side[] = ["left", "right", "top", "bottom"];
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
 * row; documents' islands never fold. Null when there is none to fold.
 */
export function foldPanel(
  layout: SplitLayout,
  isPanel: (pane: Pane) => boolean,
  need: number,
): { layout: SplitLayout; folded: Folded } | null {
  const panes = panesOf(layout.root);
  for (const panel of [...panes].reverse()) {
    if (!isPanel(panel)) continue;
    for (const side of SIDES) {
      const into = paneBeside(layout.root, panel.id, side);
      if (!into) continue;
      let next: SplitLayout | null = layout;
      for (const tab of panel.tabs) next = next && moveTab(next, tab, into.id);
      if (!next) return null;
      // The island it joined keeps showing what it showed.
      next = {
        ...next,
        root: withFront(next.root, into.id, into.front),
        focus: layout.focus === panel.id ? into.id : layout.focus,
      };
      return {
        layout: next,
        folded: {
          tabs: [...panel.tabs],
          front: panel.front,
          into: into.id,
          side: OPPOSITE[side],
          need,
        },
      };
    }
  }
  return null;
}

/** A folded panel back on its side of the island it joined, with the tabs
 *  it had that are still open; null when none are or that island is gone. */
export function unfoldPanel(
  layout: SplitLayout,
  folded: Folded,
): SplitLayout | null {
  const into = panesOf(layout.root).find((p) => p.id === folded.into);
  const tabs = folded.tabs.filter((t) => into?.tabs.includes(t));
  if (!into || !tabs.length || tabs.length === into.tabs.length) return null;
  let next = splitOff(layout, tabs[0], into.id, folded.side);
  const back = next && panesOf(next.root).find((p) => p.tabs[0] === tabs[0]);
  if (!next || !back) return null;
  for (const tab of tabs.slice(1)) next = next && moveTab(next, tab, back.id);
  if (!next) return null;
  const front =
    folded.front && tabs.includes(folded.front) ? folded.front : tabs[0];
  return {
    ...next,
    root: withFront(withFront(next.root, back.id, front), into.id, into.front),
    focus: layout.focus,
  };
}

/** Pane `id` showing `front`, when it holds it. */
function withFront(root: Branch, id: string, front: string | null): Branch {
  return mapPanes(root, (p) =>
    p.id === id && front && p.tabs.includes(front) ? { ...p, front } : p,
  ) as Branch;
}
