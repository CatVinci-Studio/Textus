import { shownIsland } from "./store";
import { scaledPx } from "../tokens/chrome-scale";
import { isPhoneLayout } from "../../platform/phone-layout";
import { frameLayout } from "../frame/frame-store";
import type { Rect } from "../frame/rect";
import { stripPlaces } from "../controls/tabs/tab-strips";
import { tabsStartOf } from "./row-insets";

/*
 * Where something dragged over the islands would land (design-language.md,
 * layout and drag): read from the layout as the drag found it (DropGeometry)
 * so the islands making room under the pointer never move its target.
 */

/**
 * The side of the document a dragged tab or file would open on; the middle
 * just brings it to the front.
 */
type DropZone = "left" | "right" | "top" | "bottom" | "center";

export interface DropTarget {
  zone: DropZone;
  /** The tab whose document is under the pointer. */
  tabId: string;
  /** Where that document is drawn, or all of them for `whole`. */
  rect: DOMRect;
  /** On the outer edge of a split: beside all its panes, not just one. */
  whole?: boolean;
}

/** What is dragged: a tab, a whole island (Alt), or a file from the
 *  sidebar or a file manager. */
export type DragKind = "tab" | "island" | "file";

type Side = Exclude<DropZone, "center">;
/** Whose bands a drag goes by: a whole island's are a tab's. */
type Bands = "tab" | "file";

/** How near a side puts a drop there: a share of the length across that
 *  way, kept between two lengths (interface px). */
interface Band {
  share: number;
  min?: number;
  max?: number;
}

/** By what is dragged, how near an island's side opens a new island beside
 *  it; its top or bottom stacks one in that island's column alone - wider
 *  than the window's outer band under it, which stacks one under all of
 *  them. Inside that, it joins the island. A file mostly goes into the
 *  document or opens in it, so its bands are narrow, and above or below
 *  is no place for one. */
const EDGE: Record<Bands, Record<Side, Band | null>> = {
  tab: {
    left: { share: 0.2 },
    right: { share: 0.2 },
    top: { share: 0.15 },
    bottom: { share: 0.15 },
  },
  file: {
    left: { share: 0.08, min: 40, max: 80 },
    right: { share: 0.08, min: 40, max: 80 },
    top: null,
    bottom: null,
  },
};
/** The place already aimed at holds a little past its line, so a pointer
 *  resting on it doesn't flicker between two. */
const HOLD = 1.25;
/** For a whole island, which can't join another: how near the top or
 *  bottom (a share of the height) stacks it there; else the half it is
 *  over puts it on that side. */
const STACK_EDGE = 0.12;
/** How near the documents' outer edge puts a drop beside all of them; a
 *  file only to their left or right, as on one island. */
const OUTER_BAND: Band = { share: 0.04, min: 26, max: 52 };
const OUTER: Record<Bands, Record<Side, Band | null>> = {
  tab: {
    left: OUTER_BAND,
    right: OUTER_BAND,
    top: OUTER_BAND,
    bottom: OUTER_BAND,
  },
  file: { left: OUTER_BAND, right: OUTER_BAND, top: null, bottom: null },
};

/** `band` across `length`, in viewport px. */
function bandPx(band: Band, length: number): number {
  const min = band.min === undefined ? 0 : scaledPx(band.min);
  const max = band.max === undefined ? Infinity : scaledPx(band.max);
  return Math.min(max, Math.max(min, length * band.share));
}

/** How far (x, y) is from each side of `rect`, in viewport px. */
function distances(rect: DOMRect, x: number, y: number): Record<Side, number> {
  return {
    top: y - rect.top,
    bottom: rect.bottom - y,
    left: x - rect.left,
    right: rect.right - x,
  };
}

const across = (side: Side, rect: DOMRect) =>
  side === "left" || side === "right" ? rect.width : rect.height;

/** The side of `rect` nearest (x, y) by `bands` (null: never that side),
 *  each widened by `hold`, and how near: its distance over its band, 1 at
 *  the band's line. */
function nearestSide(
  rect: DOMRect,
  x: number,
  y: number,
  bands: Record<Side, Band | null>,
  hold: (side: Side) => number = () => 1,
): [Side, number] | null {
  const away = distances(rect, x, y);
  let best: [Side, number] | null = null;
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const band = bands[side];
    if (!band) continue;
    const px = bandPx(band, across(side, rect)) * hold(side);
    const near = away[side] / px;
    if (!best || near < best[1]) best = [side, near];
  }
  return best;
}

/** The split's outer edge under (x, y), if it is near one. */
function outerEdge(
  area: DOMRect,
  x: number,
  y: number,
  bands: Bands,
): Side | null {
  const nearest = nearestSide(area, x, y, OUTER[bands]);
  return nearest && nearest[1] < 1 ? nearest[0] : null;
}

function union(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Where the documents and their tab rows are, as the drag found them:
 *  a drag tests against the layout it began over, not the preview moving
 *  under it. */
export interface DropGeometry {
  /** The islands: each one's body and the tab in front there. */
  panes: { rect: DOMRect; tabId: string | undefined }[];
  /** Their tab rows: the row, its tabs' centres, its island's body. */
  bars: {
    pane: string;
    row: DOMRect;
    pills: { id: string; center: number }[];
    body: DOMRect;
  }[];
}

const domRect = (r: Rect) => new DOMRect(r.x, r.y, r.w, r.h);

/** The islands as the solver placed them and their tabs as their strips
 *  laid them out (frame-store, tab-strips). */
export function dropGeometry(): DropGeometry {
  const { islands } = frameLayout();
  return {
    panes: islands.map((island) => ({
      rect: domRect(island.sheet),
      tabId: shownIsland(island.paneId)?.front ?? undefined,
    })),
    bars: islands.flatMap((island) => {
      const pane = island.paneId;
      const strip = stripPlaces(pane);
      const start = tabsStartOf(pane);
      if (!island.row || !strip || start === null) return [];
      const from = start - strip.scrolled();
      return [
        {
          pane,
          // Its whole row, the room kept at its ends included.
          row: domRect(island.row),
          pills: strip.ids.map((id, i) => ({
            id,
            center: from + strip.slots[i]!.x + strip.slots[i]!.w / 2,
          })),
          // Lit where the document will show, not over the bar.
          body: domRect(island.sheet),
        },
      ];
    }),
  };
}

/** Where tab `id` of pane `pane`'s row (null: a row of no island) is
 *  drawn, in the viewport: its strip's place for it on its row. */
export function tabRectOf(pane: string | null, id: string): DOMRect | null {
  const island = frameLayout().islands.find((i) => i.paneId === pane);
  const strip = stripPlaces(pane);
  const start = tabsStartOf(pane);
  const slot = strip?.slots[strip.ids.indexOf(id)];
  if (!island?.row || !strip || !slot || start === null) return null;
  const x = start - strip.scrolled() + slot.x;
  return new DOMRect(x, island.row.y, slot.w, island.row.h);
}

/** The zone of the document under (x, y) for what is dragged (`drag`);
 *  null off the documents. `held`, the one aimed at until now, keeps its
 *  zone a little past its line. */
export function dropTargetAt(
  x: number,
  y: number,
  geometry: DropGeometry = dropGeometry(),
  drag: DragKind = "tab",
  held?: DropTarget | null,
): DropTarget | null {
  const { panes } = geometry;
  const pane = panes.find((p) => inside(p.rect, x, y));
  if (!pane?.tabId) return null;
  // A phone shows one island: whatever is dropped joins it.
  if (isPhoneLayout())
    return { zone: "center", tabId: pane.tabId, rect: pane.rect };
  const bands: Bands = drag === "file" ? "file" : "tab";
  // Split, an outer edge puts it beside all of them.
  if (panes.length > 1) {
    const area = union(panes.map((p) => p.rect));
    const edge = outerEdge(area, x, y, bands);
    if (edge) return { zone: edge, tabId: pane.tabId, rect: area, whole: true };
  }
  const { rect, tabId } = pane;
  if (!tabId || !inside(rect, x, y)) return null;
  if (drag === "island") {
    const fx = (x - rect.left) / rect.width;
    const fy = (y - rect.top) / rect.height;
    return { zone: halfAt(fx, fy), tabId, rect };
  }
  const kept = held && !held.whole && held.tabId === tabId ? held.zone : null;
  const hold = (side: Side) =>
    kept === side ? HOLD : kept === "center" ? 1 / HOLD : 1;
  const nearest = nearestSide(rect, x, y, EDGE[bands], hold);
  const zone: DropZone = nearest && nearest[1] <= 1 ? nearest[0] : "center";
  return { zone, tabId, rect };
}

function halfAt(fx: number, fy: number): DropZone {
  if (fy < STACK_EDGE) return "top";
  if (fy > 1 - STACK_EDGE) return "bottom";
  return fx < 0.5 ? "left" : "right";
}

/** An island's tab row under (x, y), and the slot there: how many of its
 *  other tabs lie left of x. */
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
