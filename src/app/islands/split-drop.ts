import {
  closeSplit,
  paneOf,
  previewSplit,
  setSplitLayout,
  windowLayout,
  placeOnArrival,
  withRoom,
} from "../../engine/layout/store";
import { moveTab, splitOff, type SplitLayout } from "../../engine/layout/ops";
import { paneById, paneWithTab } from "../../engine/layout/tree";
import {
  dropGeometry,
  dropTargetAt,
  type DropGeometry,
  type DropTarget,
} from "../../engine/layout/drop-zones";
import "./split-drop.css";
import { transientStyle } from "../../engine/tokens/appearance";
import type { NoRoom } from "../../engine/frame/frame-store";
import { sayNoRoom } from "../menu/split-here";

/**
 * The layout once `tabId` is dropped at `target`: on an island's edge, in a
 * new island on that side of it (on the split's outer edge, beside all of
 * them); in its middle, in that island. Undefined: the drop changes
 * nothing.
 */
function dropLayout(
  now: SplitLayout,
  tabId: string,
  target: DropTarget,
): SplitLayout | null | undefined {
  return dropPlan(now, tabId, target).next;
}

/** dropLayout, and whether an edge's new island was refused for want of
 *  room (withRoom): said when the tab is let go. */
export function dropPlan(
  now: SplitLayout,
  tabId: string,
  target: DropTarget,
): { next: SplitLayout | null | undefined; noRoom: NoRoom } {
  const none = { next: undefined, noRoom: false as const };
  if (target.whole && target.zone !== "center") {
    const { next, noRoom } = withRoom(splitOff(now, tabId, null, target.zone));
    // No room beside them all: as on the edge of the island under it.
    if (noRoom) return dropPlan(now, tabId, { ...target, whole: false });
    return { next: next ?? undefined, noRoom };
  }
  const pane = paneOf(now, target.tabId);
  if (pane === null) return none;
  const others = paneById(now.root, pane)?.tabs.some((id) => id !== tabId);
  const join =
    pane === paneOf(now, tabId) ? undefined : moveTab(now, tabId, pane);
  if (target.zone === "center") return { next: join, noRoom: false };
  // An island's only tab dropped on its own edge stays where it is.
  if (!others) return none;
  // No room for another island: it joins this one instead.
  const { next, noRoom } = withRoom(splitOff(now, tabId, pane, target.zone));
  return { next: next ?? join, noRoom };
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
  arriving = false,
): void {
  if (arriving)
    placeOnArrival(tabId, (now) => {
      const { next, noRoom } = dropPlan(now, tabId, target);
      sayNoRoom(noRoom);
      return next ?? now;
    });
  else {
    const { next, noRoom } = dropPlan(windowLayout(), tabId, target);
    sayNoRoom(noRoom);
    commitDrop(next);
  }
}

/** The tab something on its way in stands as, in the preview of where it
 *  will open. */
const ARRIVING = "drop:arriving";

/**
 * Where tab `tabId` lands in `shown`, dashed: a new island of its own is
 * only its room (no row), a slot in another island's row only its outline.
 * `room` and `row` say which pane each is.
 */
export function roomMarks(
  shown: SplitLayout | null,
  tabId: string,
): { rules: string[]; room: string | null; row: string | undefined } {
  const pane = shown && paneWithTab(shown.root, tabId);
  if (!pane) return { rules: [], room: null, row: undefined };
  if (pane.tabs.length === 1) {
    const id = CSS.escape(pane.id);
    return {
      rules: [
        `section.island[data-pane-id="${id}"] { background: var(--drop-room-island) center / 100% 100% no-repeat !important; box-shadow: none !important; }`,
        `section.island[data-pane-id="${id}"] > * { visibility: hidden; }`,
        `.island-row[data-pane-id="${id}"] { visibility: hidden; }`,
      ],
      room: pane.id,
      row: undefined,
    };
  }
  const slot = `.tab-pill[data-tab="${CSS.escape(tabId)}"]`;
  return {
    rules: [
      `${slot} { background: var(--drop-room-slot) center / 100% 100% no-repeat !important; box-shadow: none !important; }`,
      `${slot}::before, ${slot}::after { display: none !important; }`,
      `${slot} > * { visibility: hidden; }`,
    ],
    room: null,
    row: pane.id,
  };
}

/**
 * Something not yet a tab of this window dragged over its documents - a
 * file from the sidebar, a tab from another window: the islands make room
 * where it will open, as for a tab pulled within the window (pullTab).
 * Tested against the layout the drag found (DropGeometry).
 */
export function arrivalPreview() {
  let geometry: DropGeometry | null = null;
  let shown: string | null = null;
  let style: HTMLStyleElement | null = null;
  const mark = (layout: SplitLayout | null) => {
    const { rules } = roomMarks(layout, ARRIVING);
    if (!rules.length) {
      style?.remove();
      style = null;
      return;
    }
    style ??= transientStyle();
    style.textContent = rules.join("\n");
  };
  const clear = () => {
    shown = null;
    mark(null);
    previewSplit(null);
  };
  return {
    /** Where a drop at (x, y) lands, shown; null off the documents. `at`:
     *  the place already found there (a tab row's island). */
    show(x: number, y: number, at?: DropTarget | null): DropTarget | null {
      geometry ??= dropGeometry();
      const target = at !== undefined ? at : dropTargetAt(x, y, geometry);
      const key = target
        ? `${target.whole ? "whole" : target.tabId}:${target.zone}`
        : null;
      if (key === shown) return target;
      shown = key;
      const layout = target
        ? (dropLayout(windowLayout(), ARRIVING, target) ?? null)
        : null;
      mark(layout);
      previewSplit(layout);
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
    take(x: number, y: number, at?: DropTarget | null): DropTarget | null {
      const target =
        at !== undefined ? at : dropTargetAt(x, y, geometry ?? dropGeometry());
      geometry = null;
      clear();
      return target;
    },
  };
}
