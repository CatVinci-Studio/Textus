import { scaledPx } from "../tokens/chrome-scale";
import { isPhoneLayout } from "../controls/usePhoneLayout";

/*
 * Where something dragged over the islands would land (design-language.md,
 * layout and drag): read from the layout as the drag found it (DropGeometry)
 * so the islands making room under the pointer never move its target.
 */

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

/** How near an island's edge (a share of its width or height) a tab must
 *  be to open a new island there; inside that, it joins the island. */
const EDGE = 0.1;
/** The place already aimed at holds a little past its line, so a pointer
 *  resting on it doesn't flicker between two. */
const HOLD = 1.25;
/** For a whole island, which can't join another: how near the top or
 *  bottom (a share of the height) stacks it there; else the half it is
 *  over puts it on that side. */
const STACK_EDGE = 0.12;
/** How near the documents' outer edge puts a drop beside all of them: a
 *  share of that side, kept between two lengths (interface px). */
const OUTER_SHARE = 0.04;
const OUTER_MIN = 24;
const OUTER_MAX = 48;

/** The split's outer edge under (x, y), if it is near one. */
function outerEdge(
  area: DOMRect,
  x: number,
  y: number,
): "left" | "right" | "top" | "bottom" | null {
  const band = (length: number) =>
    Math.min(
      scaledPx(OUTER_MAX),
      Math.max(scaledPx(OUTER_MIN), length * OUTER_SHARE),
    );
  const across = band(area.width);
  const down = band(area.height);
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

/** The zone of the document under (x, y); null off the documents. `held`,
 *  the one aimed at until now, keeps its zone a little past its line. */
export function dropTargetAt(
  x: number,
  y: number,
  geometry: DropGeometry = dropGeometry(),
  halves = false,
  held?: DropTarget | null,
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
  if (halves) return { zone: halfAt(fx, fy), tabId, rect };
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
  const kept = held && !held.whole && held.tabId === tabId ? held.zone : null;
  const band = (side: DropZone) =>
    EDGE * (kept === side ? HOLD : kept === "center" ? 1 / HOLD : 1);
  const [side, near] = sides
    .map(([side, near]) => [side, near / band(side)] as const)
    .reduce((a, b) => (b[1] < a[1] ? b : a));
  const zone: DropZone = near > 1 ? "center" : side;
  return { zone, tabId, rect };
}

function halfAt(fx: number, fy: number): DropZone {
  if (isPhoneLayout()) return fy < 0.5 ? "top" : "bottom";
  if (fy < STACK_EDGE) return "top";
  if (fy > 1 - STACK_EDGE) return "bottom";
  return fx < 0.5 ? "left" : "right";
}

/** A split pane's tab row under (x, y), and the slot there: how many of
 *  its other tabs lie left of x. */
export function barDropAt(
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
