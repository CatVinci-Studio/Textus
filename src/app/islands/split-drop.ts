import { dragGhost } from "../../engine/drag/ghost";
import { scaledPx } from "../../engine/tokens/chrome-scale";
import {
  closeSplit,
  pairLayout,
  paneOf,
  previewSplit,
  setSplitLayout,
  splitLayout,
  type SplitDirection,
} from "../../engine/layout/store";
import {
  moveTab,
  reorderTab,
  splitOff,
  type SplitLayout,
} from "../../engine/layout/ops";
import { paneById } from "../../engine/layout/tree";
import {
  setDragging,
  type DocumentDrop,
} from "../../engine/controls/document-drop";
import { isPhoneLayout } from "../../engine/controls/usePhoneLayout";
import "./split-drop.css";

/**
 * The side of the document a dragged tab or file would open on; the middle
 * just brings it to the front.
 */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

export interface DropTarget {
  zone: DropZone;
  /** The tab whose document is under the pointer. */
  tabId: string;
  /** Where that document is drawn, or all of them for `whole`. */
  rect: DOMRect;
  /** On the outer edge of a split: beside all its panes, not just one. */
  whole?: boolean;
}

/** How near an edge (a share of the width or height) still counts as it. */
const EDGE = 0.3;
/** How near the split's outer edge (px, and at most a share of it) puts a
 *  drop beside every pane. */
const OUTER = 48;
const OUTER_SHARE = 0.1;

/** The split's outer edge under (x, y), if it is near one. */
function outerEdge(
  area: DOMRect,
  x: number,
  y: number,
): "left" | "right" | "top" | "bottom" | null {
  const outer = scaledPx(OUTER);
  const across = Math.min(outer, area.width * OUTER_SHARE);
  const down = Math.min(outer, area.height * OUTER_SHARE);
  const sides = [
    ["top", (y - area.top) / down],
    ["bottom", (area.bottom - y) / down],
    ...(isPhoneLayout()
      ? []
      : ([
          ["left", (x - area.left) / across],
          ["right", (area.right - x) / across],
        ] as const)),
  ] as const;
  const [side, near] = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
  return near < 1 ? side : null;
}

function union(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Where the documents and their tab rows are, read once: a drag tests
 *  against the layout it began over, not the preview moving under it. */
export interface DropGeometry {
  /** A split's panes: each one's body and the tab in front there. */
  panes: { rect: DOMRect; tabId: string | undefined }[];
  /** One document: the column under its tab row. */
  single: { rect: DOMRect; tabId: string | undefined } | null;
  /** A split's tab rows: the row, its tabs' centres, its pane's body. */
  bars: {
    pane: string;
    row: DOMRect;
    pills: { id: string; center: number }[];
    body: DOMRect;
  }[];
}

export function dropGeometry(): DropGeometry {
  const main = document.querySelector<HTMLElement>(".main-pane");
  const none: DropGeometry = { panes: [], single: null, bars: [] };
  if (!main) return none;
  const panes = [
    ...main.querySelectorAll<HTMLElement>(":scope > .split-pane"),
  ].map((p) => ({ rect: p.getBoundingClientRect(), tabId: p.dataset.tabId }));
  let single: DropGeometry["single"] = null;
  if (!panes.length) {
    const box = main.getBoundingClientRect();
    const bar = main.querySelector(":scope > .island-row, :scope > .tab-bar");
    const top = bar ? bar.getBoundingClientRect().bottom : box.top;
    single = {
      rect: new DOMRect(box.left, top, box.width, box.bottom - top),
      tabId: main.querySelector<HTMLElement>(
        ':scope > [data-active-tab="true"]',
      )?.dataset.tabId,
    };
  }
  const bars = [
    ...document.querySelectorAll<HTMLElement>(".tab-bar[data-pane-id]"),
  ].map((bar) => {
    const pane = bar.dataset.paneId!;
    const body = document.querySelector<HTMLElement>(
      `.split-pane[data-pane-id="${CSS.escape(pane)}"]`,
    );
    return {
      pane,
      // Its whole row, the room kept at its ends included.
      row: (bar.closest(".island-row") ?? bar).getBoundingClientRect(),
      pills: [...bar.querySelectorAll<HTMLElement>("[data-flip-id]")].map(
        (pill) => {
          const box = pill.getBoundingClientRect();
          return { id: pill.dataset.flipId!, center: box.left + box.width / 2 };
        },
      ),
      // Lit where the document will show, not over the bar.
      body: (body ?? bar).getBoundingClientRect(),
    };
  });
  return { panes, single, bars };
}

/** The zone of the document under (x, y); null off the documents. */
export function dropTargetAt(
  x: number,
  y: number,
  geometry: DropGeometry = dropGeometry(),
): DropTarget | null {
  let rect: DOMRect;
  let tabId: string | undefined;
  const { panes, single } = geometry;
  if (panes.length) {
    const pane = panes.find((p) => inside(p.rect, x, y));
    if (!pane?.tabId) return null;
    const area = union(panes.map((p) => p.rect));
    const edge = outerEdge(area, x, y);
    if (edge) return { zone: edge, tabId: pane.tabId, rect: area, whole: true };
    rect = pane.rect;
    tabId = pane.tabId;
  } else {
    if (!single) return null;
    rect = single.rect;
    tabId = single.tabId;
  }
  if (!tabId || !inside(rect, x, y)) return null;
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const sides: [DropZone, number][] = [
    ["top", fy],
    ["bottom", 1 - fy],
    // A phone's column is too narrow to share: documents only stack there.
    ...(isPhoneLayout()
      ? []
      : ([
          ["left", fx],
          ["right", 1 - fx],
        ] as [DropZone, number][])),
  ];
  const [side, near] = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
  const zone: DropZone = near > EDGE ? "center" : side;
  return { zone, tabId, rect };
}

/** A split pane's tab row under (x, y), and the slot there: how many of
 *  its other tabs lie left of x. */
function barDropAt(
  x: number,
  y: number,
  tabId: string,
  geometry: DropGeometry,
): { pane: string; index: number; rect: DOMRect } | null {
  const bar = geometry.bars.find((b) => inside(b.row, x, y));
  if (!bar) return null;
  const index = bar.pills.filter((p) => p.id !== tabId && p.center < x).length;
  return { pane: bar.pane, index, rect: bar.body };
}

function inside(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The share a pane added beside the whole split on `zone` gets. */
function wholeShare(zone: DropZone): number {
  const root = splitLayout()?.root;
  const direction = zone === "left" || zone === "right" ? "row" : "column";
  return root?.kind === "split" && root.direction === direction
    ? 1 / (root.children.length + 1)
    : 0.5;
}

let hint: HTMLDivElement | null = null;

/** Lights up where a drop at `target` would put the document; null
 *  takes the light away. */
export function showDropHint(target: DropTarget | null): void {
  if (!target) {
    hint?.remove();
    hint = null;
    return;
  }
  if (!hint) {
    hint = document.createElement("div");
    hint.className = "split-drop-hint";
    hint.setAttribute("aria-hidden", "true");
    document.body.append(hint);
  }
  const { rect, zone } = target;
  // Beside every pane, the new one takes what each of those beside it will.
  const share = target.whole ? wholeShare(zone) : 0.5;
  const half = (w: number) => w * share;
  const box = {
    left: zone === "right" ? rect.right - half(rect.width) : rect.left,
    top: zone === "bottom" ? rect.bottom - half(rect.height) : rect.top,
    width: zone === "left" || zone === "right" ? half(rect.width) : rect.width,
    height:
      zone === "top" || zone === "bottom" ? half(rect.height) : rect.height,
  };
  Object.assign(hint.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
}

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
function commitDrop(next: SplitLayout | null | undefined): void {
  if (next) setSplitLayout(next);
  else if (next === null) closeSplit();
}

/** Puts `tabId` where it was dropped (dropLayout). Call once `tabId` is
 *  among the window's tabs and in front. */
export function splitForDrop(
  tabId: string,
  target: DropTarget,
  tabIds: readonly string[],
): void {
  commitDrop(dropLayout(splitLayout(), tabId, target, tabIds));
}

/** How long the pointer rests on a place before the layout shows it: a
 *  drag passing over places doesn't flicker through them. */
const PREVIEW_DWELL_MS = 80;

/**
 * A tab pulled down out of the tab bar, followed to its drop: over a
 * document it splits there, onto a pane's tab bar it joins that pane where
 * it is let go, out of the window it tears off where possible. Escape
 * cancels.
 */
export function pullTab(
  tabId: string,
  title: string,
  opts: {
    tabIds: readonly string[];
    activate: (id: string) => void;
    detach?: (id: string) => void;
    /** Let go outside the window, where `detach` can't follow the pointer. */
    releaseOutside?: (id: string) => void;
  },
): void {
  const ghost = dragGhost(title, "tab-pull-ghost");
  setDragging(true);
  // Tested against the layout the drag began over (DropGeometry).
  const geometry = dropGeometry();
  const outside = (e: PointerEvent) =>
    e.clientX < 0 ||
    e.clientY < 0 ||
    e.clientX > window.innerWidth ||
    e.clientY > window.innerHeight;
  /** The layout a drop at (x, y) makes, and a key naming the place. */
  const placeAt = (x: number, y: number) => {
    const now = splitLayout();
    const bar = barDropAt(x, y, tabId, geometry);
    if (bar && now) {
      const moved = moveTab(now, tabId, bar.pane);
      return {
        key: `bar:${bar.pane}:${bar.index}`,
        next: moved && reorderTab(moved, bar.pane, tabId, bar.index),
      };
    }
    const target = dropTargetAt(x, y, geometry);
    if (!target) return null;
    return {
      key: `${target.whole ? "whole" : target.tabId}:${target.zone}`,
      next: dropLayout(now, tabId, target, opts.tabIds),
    };
  };
  let shown: string | null = null;
  let timer = 0;
  /** The layout shows the place under the pointer once it rests there. */
  const preview = (place: ReturnType<typeof placeAt>) => {
    const key = place?.key ?? null;
    if (key === shown) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      shown = key;
      previewSplit(place?.next ?? null);
    }, PREVIEW_DWELL_MS);
  };
  const move = (e: PointerEvent) => {
    // Let go where no pointerup reached the page (WebView2 can lose it).
    if (e.buttons === 0) {
      up(e);
      return;
    }
    if (opts.detach && outside(e)) {
      stop();
      opts.detach(tabId);
      return;
    }
    ghost.move(e.clientX, e.clientY);
    preview(placeAt(e.clientX, e.clientY));
  };
  const up = (e: PointerEvent) => {
    if (opts.releaseOutside && outside(e)) {
      stop();
      opts.releaseOutside(tabId);
      return;
    }
    const place = placeAt(e.clientX, e.clientY);
    if (place) {
      opts.activate(tabId);
      // The layout it showed, made before the preview goes: the same
      // panes, so nothing jumps back and forth.
      commitDrop(place.next);
    }
    stop();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") stop();
  };
  function stop() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("keydown", key, true);
    window.clearTimeout(timer);
    ghost.remove();
    setDragging(false);
    previewSplit(null);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", stop);
  window.addEventListener("keydown", key, true);
}

/** What a sidebar file dragged over the documents does: `open` gets where
 *  it was let go. */
export function fileDropOnDocuments(
  open: (path: string, target: DropTarget) => void,
): DocumentDrop {
  return {
    over(x, y) {
      const target = dropTargetAt(x, y);
      showDropHint(target);
      return !!target;
    },
    leave: () => showDropHint(null),
    drop(path, x, y) {
      const target = dropTargetAt(x, y);
      showDropHint(null);
      if (!target) return false;
      open(path, target);
      return true;
    },
  };
}
