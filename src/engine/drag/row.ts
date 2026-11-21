import { flip, stopFlips } from "../motion/flip";

/**
 * One item dragged along a row or column of its siblings, the others
 * making room as it passes them - the rail's one column (rail-drag) and a
 * table's rows and columns (table-grips); a row of document tabs is the
 * tab strip's, on the frame clock. Measured once when the drag begins
 * (layout values, untouched by transforms in flight); each move finds the
 * place by binary search and moves only the items whose shift changed.
 * They make room as the blocks around a pulled one do, glided by FLIP.
 */
interface RowItem {
  id: string;
  node: HTMLElement;
}

/** The items making way for one dragged from `from` to `to`: each moved
 *  `room` along `axis` as its shift changes from `shown` (kept up to date). */
export function slideAside(
  others: readonly RowItem[],
  shown: number[],
  from: number,
  to: number,
  room: number,
  axis: "x" | "y",
): void {
  const shifts = shiftsOf(others.length, from, to, room);
  const moving = others.filter((_, i) => shifts[i] !== shown[i]);
  if (!moving.length) return;
  flip(
    moving.map((item) => item.node),
    () =>
      others.forEach((item, i) => {
        if (shifts[i] === shown[i]) return;
        shown[i] = shifts[i]!;
        item.node.style.transform = shiftBy(shifts[i]!, axis);
      }),
    MAKE_ROOM,
  );
}

/** Every item back where it is laid out, at once. */
export function clearSlides(items: readonly RowItem[]): void {
  stopFlips(items.map((item) => item.node));
  for (const item of items) {
    item.node.style.transform = "";
    item.node.style.translate = "";
    item.node.style.zIndex = "";
  }
}

/** How the others make room: resting on their `transform`, gliding there
 *  on `translate` at FLIP's settle. */
export const MAKE_ROOM = { onTranslate: true } as const;

/** A `transform` moving `by` px along `axis`; none for 0. */
export function shiftBy(by: number, axis: "x" | "y"): string {
  if (!by) return "";
  return `${axis === "x" ? "translateX" : "translateY"}(${by}px)`;
}

/** How many of `centers` (ascending) lie before `at`. */
export function passedCount(centers: readonly number[], at: number): number {
  let lo = 0;
  let hi = centers.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (centers[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The shift of the other item at `i` (its place among the others) when
 *  the dragged one, first at `from` among them, would land at `to`. */
export function shiftAt(i: number, from: number, to: number, room: number) {
  if (to > from && i >= from && i < to) return -room;
  if (to < from && i >= to && i < from) return room;
  return 0;
}

/** Each of the `count` others' shifts for the same move. */
export function shiftsOf(
  count: number,
  from: number,
  to: number,
  room: number,
): number[] {
  return Array.from({ length: count }, (_, i) => shiftAt(i, from, to, room));
}
