import {
  closeSplit,
  paneOf,
  previewSplit,
  setSplitLayout,
  splitLayout,
  placeOnArrival,
} from "../../engine/layout/store";
import { type SplitDirection } from "../../engine/layout/tree";
import { pairLayout } from "../../engine/layout/ops";
import { moveTab, splitOff, type SplitLayout } from "../../engine/layout/ops";
import { paneById } from "../../engine/layout/tree";
import type { DocumentDrop } from "../../engine/controls/document-drop";
import {
  dropGeometry,
  dropTargetAt,
  type DropGeometry,
  type DropTarget,
} from "../../engine/layout/drop-zones";
import "./split-drop.css";

/**
 * The layout once `tabId` is dropped at `target`: on a pane's edge, in a
 * new pane on that side of it; in its middle, in that pane. With one
 * document an edge splits the window, and a tab dropped on its own
 * document pairs with a neighbour. Null ends the split; undefined: the
 * drop changes nothing.
 */
export function dropLayout(
  now: SplitLayout | null,
  tabId: string,
  target: DropTarget,
  tabIds: readonly string[],
): SplitLayout | null | undefined {
  if (now && target.whole && target.zone !== "center")
    return splitOff(now, tabId, null, target.zone) ?? undefined;
  const pane = paneOf(now, target.tabId);
  if (now && pane !== null) {
    if (target.zone === "center") return moveTab(now, tabId, pane);
    // A pane's only tab dropped on its own edge stays where it is.
    if (!paneById(now.root, pane)?.tabs.some((id) => id !== tabId))
      return undefined;
    return splitOff(now, tabId, pane, target.zone) ?? undefined;
  }
  if (target.zone === "center") return undefined;
  let other = target.tabId;
  if (other === tabId) {
    const at = tabIds.indexOf(tabId);
    other = tabIds[at + 1] ?? tabIds[at - 1];
    if (!other) return undefined;
  }
  const direction: SplitDirection =
    target.zone === "left" || target.zone === "right" ? "row" : "column";
  const first = target.zone === "left" || target.zone === "top";
  // The window's other tabs stay with the document dropped beside, in
  // their order.
  const rest = tabIds.filter((id) => id !== tabId);
  const layout = first
    ? pairLayout(direction, tabId, other, 1)
    : pairLayout(direction, other, tabId, 0);
  const [a, b] = layout.root.children;
  if (a.kind === "pane" && b.kind === "pane") (first ? b : a).tabs = rest;
  return layout;
}

/** Commits a layout dropLayout gave. */
export function commitDrop(next: SplitLayout | null | undefined): void {
  if (next) setSplitLayout(next);
  else if (next === null) closeSplit();
}

/** Puts `tabId` where it was dropped (dropLayout): at once for a tab of
 *  the window, else as it arrives (placeOnArrival), never first drawn in
 *  the pane in use. */
export function splitForDrop(
  tabId: string,
  target: DropTarget,
  tabIds: readonly string[],
  arriving = false,
): void {
  if (arriving)
    placeOnArrival(
      tabId,
      (now) => dropLayout(now, tabId, target, tabIds) ?? now,
    );
  else commitDrop(dropLayout(splitLayout(), tabId, target, tabIds));
}

/** The pane something on its way in shows in, in the preview of where it
 *  will open: an island of its own, still empty. */
const ARRIVING = "drop:arriving";

/**
 * Something not yet a tab of this window dragged over its documents - a
 * file from the sidebar, a tab from another window: the islands make room
 * where it will open, as for a tab pulled within the window (pullTab).
 * Tested against the layout the drag found (DropGeometry).
 */
export function arrivalPreview(tabIds: () => readonly string[]) {
  let geometry: DropGeometry | null = null;
  let shown: string | null = null;
  const clear = () => {
    shown = null;
    previewSplit(null);
  };
  return {
    /** Where a drop at (x, y) lands, shown; null off the documents. */
    show(x: number, y: number): DropTarget | null {
      geometry ??= dropGeometry();
      const target = dropTargetAt(x, y, geometry);
      const key = target
        ? `${target.whole ? "whole" : target.tabId}:${target.zone}`
        : null;
      if (key === shown) return target;
      shown = key;
      previewSplit(
        target
          ? (dropLayout(splitLayout(), ARRIVING, target, [
              ...tabIds(),
              ARRIVING,
            ]) ?? null)
          : null,
      );
      return target;
    },
    /** Nothing shown; the layout the drag found kept for a drop that
     *  follows at once. */
    clear() {
      clear();
      const was = geometry;
      window.setTimeout(() => {
        if (geometry === was) geometry = null;
      }, 0);
    },
    /** Where a drop at (x, y) lands, the preview gone. */
    take(x: number, y: number): DropTarget | null {
      const target = dropTargetAt(x, y, geometry ?? dropGeometry());
      geometry = null;
      clear();
      return target;
    },
  };
}

/** What a sidebar file dragged over the documents does: room made where it
 *  will open (arrivalPreview); `open` gets where it was let go. With Shift
 *  held it is linked to instead (`link`). */
export function fileDropOnDocuments(
  open: (path: string, target: DropTarget) => void,
  opts: { tabIds: () => readonly string[]; link: (path: string) => void },
): DocumentDrop {
  const arrival = arrivalPreview(opts.tabIds);
  return {
    over(x, y, link = false) {
      if (!link) return !!arrival.show(x, y);
      arrival.clear();
      return !!dropTargetAt(x, y);
    },
    leave: arrival.clear,
    drop(path, x, y, link = false) {
      const target = arrival.take(x, y);
      if (!target) return false;
      if (link) opts.link(path);
      else open(path, target);
      return true;
    },
  };
}
