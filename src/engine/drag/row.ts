/** One slide for every item making way, so overlapping moves read as one:
 *  the settle spring (motion.css). */
const SLIDE =
  "transform calc(var(--dur-settle) * var(--motion-travel)) var(--ease-settle)";

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
  const translate = axis === "x" ? "translateX" : "translateY";
  others.forEach((item, i) => {
    const shift = shiftAt(i, from, to, room);
    if (shift === shown[i]) return;
    shown[i] = shift;
    item.node.style.transition = SLIDE;
    item.node.style.transform = shift ? `${translate}(${shift}px)` : "";
  });
}

/** Every item back where it is laid out. */
export function clearSlides(items: readonly RowItem[]): void {
  for (const item of items) {
    item.node.style.transition = "";
    item.node.style.transform = "";
    item.node.style.translate = "";
    item.node.style.zIndex = "";
  }
}

/**
 * One item dragged along a row or column of its siblings, the others
 * making room as it passes them - the sidebar's tabs (a row of document
 * tabs is the tab strip's; the rail's one column, rail-drag, slides by
 * the same steps). Measured once when the drag begins (layout values,
 * untouched by transforms in flight); each move finds the place by binary
 * search and restyles only the items whose shift changed.
 */
interface RowItem {
  id: string;
  node: HTMLElement;
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
