import {
  closeSplit,
  paneOf,
  previewSplit,
  setSplitLayout,
  windowLayout,
  placeOnArrival,
} from "../../engine/layout/store";
import { moveTab, splitOff, type SplitLayout } from "../../engine/layout/ops";
import { paneById, paneWithTab } from "../../engine/layout/tree";
import type { DocumentDrop } from "../../engine/controls/document-drop";
import {
  dropGeometry,
  dropTargetAt,
  type DropGeometry,
  type DropTarget,
} from "../../engine/layout/drop-zones";
import "./split-drop.css";
import { transientStyle } from "../../engine/tokens/appearance";

/**
 * The layout once `tabId` is dropped at `target`: on an island's edge, in a
 * new island on that side of it (on the split's outer edge, beside all of
 * them); in its middle, in that island. Undefined: the drop changes
 * nothing.
 */
export function dropLayout(
  now: SplitLayout,
  tabId: string,
  target: DropTarget,
): SplitLayout | null | undefined {
  if (target.whole && target.zone !== "center")
    return splitOff(now, tabId, null, target.zone) ?? undefined;
  const pane = paneOf(now, target.tabId);
  if (pane === null) return undefined;
  const others = paneById(now.root, pane)?.tabs.some((id) => id !== tabId);
  if (target.zone === "center")
    return pane === paneOf(now, tabId) ? undefined : moveTab(now, tabId, pane);
  // An island's only tab dropped on its own edge stays where it is.
  if (!others) return undefined;
  return splitOff(now, tabId, pane, target.zone) ?? undefined;
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
    placeOnArrival(tabId, (now) => dropLayout(now, tabId, target) ?? now);
  else commitDrop(dropLayout(windowLayout(), tabId, target));
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
    /** Where a drop at (x, y) lands, shown; null off the documents. */
    show(x: number, y: number): DropTarget | null {
      geometry ??= dropGeometry();
      const target = dropTargetAt(x, y, geometry);
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
  opts: { link: (path: string) => void },
): DocumentDrop {
  const arrival = arrivalPreview();
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
