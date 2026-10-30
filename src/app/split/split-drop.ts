import {
  moveToPane,
  pairLayout,
  paneOf,
  reorderInPane,
  setSplitLayout,
  splitAtEdge,
  splitBeside,
  splitLayout,
  type SplitDirection,
} from "./split-layout";
import { paneById } from "./split-tree";
import { setDragging, type DocumentDrop } from "../../ui/document-drop";
import { PHONE_QUERY } from "../../ui/usePhoneLayout";
import { isIOSApp } from "../../platform/capabilities";
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
  const across = Math.min(OUTER, area.width * OUTER_SHARE);
  const down = Math.min(OUTER, area.height * OUTER_SHARE);
  const sides = [
    ["top", (y - area.top) / down],
    ["bottom", (area.bottom - y) / down],
    ...(stackOnly()
      ? []
      : ([
          ["left", (x - area.left) / across],
          ["right", (area.right - x) / across],
        ] as const)),
  ] as const;
  const [side, near] = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
  return near < 1 ? side : null;
}

/** On a phone, documents split only one above the other. */
function stackOnly(): boolean {
  return isIOSApp && matchMedia(PHONE_QUERY).matches;
}

function union(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/** The zone of the document under (x, y); null off the documents. */
export function dropTargetAt(x: number, y: number): DropTarget | null {
  const main = document.querySelector<HTMLElement>(".main-pane");
  if (!main) return null;
  const panes = [...main.querySelectorAll<HTMLElement>(":scope > .split-pane")];
  let rect: DOMRect;
  let tabId: string | undefined;
  if (panes.length) {
    const pane = panes.find((p) => inside(p.getBoundingClientRect(), x, y));
    if (!pane?.dataset.tabId) return null;
    const area = union(panes.map((p) => p.getBoundingClientRect()));
    const edge = outerEdge(area, x, y);
    if (edge)
      return { zone: edge, tabId: pane.dataset.tabId, rect: area, whole: true };
    rect = pane.getBoundingClientRect();
    tabId = pane.dataset.tabId;
  } else {
    // One document: the column below the tab bar.
    const box = main.getBoundingClientRect();
    const bar = main.querySelector(":scope > .tab-bar");
    const top = bar ? bar.getBoundingClientRect().bottom : box.top;
    rect = new DOMRect(box.left, top, box.width, box.bottom - top);
    tabId = main.querySelector<HTMLElement>(':scope > [data-active-tab="true"]')
      ?.dataset.tabId;
  }
  if (!tabId || !inside(rect, x, y)) return null;
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const sides: [DropZone, number][] = [
    ["top", fy],
    ["bottom", 1 - fy],
    // A phone's column is too narrow to share: documents only stack there.
    ...(stackOnly()
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

/** A split pane's tab bar under (x, y), and the slot there: how many of
 *  its other tabs lie left of x. */
function barDropAt(
  x: number,
  y: number,
  tabId: string,
): { pane: string; index: number; rect: DOMRect } | null {
  const bar = [
    ...document.querySelectorAll<HTMLElement>(".tab-bar[data-pane-id]"),
  ].find((el) => inside(el.getBoundingClientRect(), x, y));
  if (!bar) return null;
  const index = [...bar.querySelectorAll<HTMLElement>("[data-flip-id]")].filter(
    (pill) => {
      const box = pill.getBoundingClientRect();
      return pill.dataset.flipId !== tabId && box.left + box.width / 2 < x;
    },
  ).length;
  const pane = bar.dataset.paneId!;
  // Lit where the document will show, not over the bar (and the title bar
  // a top pane's bar reaches under).
  const body = document.querySelector<HTMLElement>(
    `.split-pane[data-pane-id="${CSS.escape(pane)}"]`,
  );
  return {
    pane,
    index,
    rect: (body ?? bar).getBoundingClientRect(),
  };
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
 * Puts `tabId` where it was dropped: on a pane's edge, into a new pane on
 * that side of it; in its middle, into that pane. With one document an
 * edge splits the window, and a tab dropped on its own document pairs with
 * a neighbour. Call once `tabId` is among the window's tabs and in front.
 */
export function splitForDrop(
  tabId: string,
  target: DropTarget,
  tabIds: readonly string[],
): void {
  const now = splitLayout();
  if (now && target.whole && target.zone !== "center") {
    splitAtEdge(tabId, target.zone);
    return;
  }
  const pane = paneOf(now, target.tabId);
  if (now && pane !== null) {
    if (target.zone === "center") moveToPane(tabId, pane);
    // A pane's only tab dropped on its own edge stays where it is.
    else if (paneById(now.root, pane)?.tabs.some((id) => id !== tabId))
      splitBeside(tabId, pane, target.zone);
    return;
  }
  if (target.zone === "center") return;
  let other = target.tabId;
  if (other === tabId) {
    const at = tabIds.indexOf(tabId);
    other = tabIds[at + 1] ?? tabIds[at - 1];
    if (!other) return;
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
  if (a.kind === "pane" && b.kind === "pane") {
    (first ? b : a).tabs = rest;
  }
  setSplitLayout(layout);
}

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
  const ghost = document.createElement("div");
  ghost.className = "tab-pull-ghost";
  ghost.textContent = title;
  ghost.setAttribute("aria-hidden", "true");
  document.body.append(ghost);
  setDragging(true);
  const outside = (e: PointerEvent) =>
    e.clientX < 0 ||
    e.clientY < 0 ||
    e.clientX > window.innerWidth ||
    e.clientY > window.innerHeight;
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
    ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
    const bar = barDropAt(e.clientX, e.clientY, tabId);
    showDropHint(
      bar
        ? { zone: "center", tabId, rect: bar.rect }
        : dropTargetAt(e.clientX, e.clientY),
    );
  };
  const up = (e: PointerEvent) => {
    const bar = barDropAt(e.clientX, e.clientY, tabId);
    const target = dropTargetAt(e.clientX, e.clientY);
    stop();
    if (opts.releaseOutside && outside(e)) {
      opts.releaseOutside(tabId);
      return;
    }
    if (bar) {
      opts.activate(tabId);
      requestAnimationFrame(() => {
        moveToPane(tabId, bar.pane);
        reorderInPane(bar.pane, tabId, bar.index);
      });
      return;
    }
    if (!target) return;
    opts.activate(tabId);
    // Once it is in front, the next frame: the split takes it from there.
    requestAnimationFrame(() => splitForDrop(tabId, target, opts.tabIds));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") stop();
  };
  function stop() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("keydown", key, true);
    ghost.remove();
    setDragging(false);
    showDropHint(null);
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
