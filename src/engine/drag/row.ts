import { trackDrag } from "./pointer-drag";

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
export interface RowItem {
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

interface Row {
  /** Where the dragged item lands with its centre moved by `offset`: its
   *  index among the others. */
  index(offset: number): number;
  /** Follows a move: the dragged item at `offset`, the others aside. */
  move(offset: number): void;
  /** Everything back as it was laid out. */
  clear(): void;
  /** The dragged item's index among the others before the drag. */
  readonly from: number;
}

function row(
  items: readonly RowItem[],
  id: string,
  { axis = "x", gap = 0 }: { axis?: "x" | "y"; gap?: number } = {},
): Row {
  const horizontal = axis === "x";
  const at = items.findIndex((item) => item.id === id);
  const dragged = items[at]?.node;
  const others = items.filter((item) => item.id !== id);
  const centerOf = (node: HTMLElement) =>
    horizontal
      ? node.offsetLeft + node.offsetWidth / 2
      : node.offsetTop + node.offsetHeight / 2;
  const centers = others.map((item) => centerOf(item.node));
  const mine = dragged ? centerOf(dragged) : 0;
  const room =
    (dragged ? (horizontal ? dragged.offsetWidth : dragged.offsetHeight) : 0) +
    gap;
  const from = Math.max(0, at);
  const shown = new Array<number>(others.length).fill(0);
  const index = (offset: number) => passedCount(centers, mine + offset);
  return {
    from,
    index,
    move(offset) {
      if (!dragged) return;
      dragged.style.transition = "none";
      // `translate`, not `transform`: the lifted look's scale would scale
      // the offset too, and the item drift off the pointer.
      dragged.style.translate = horizontal ? `${offset}px 0` : `0 ${offset}px`;
      dragged.style.zIndex = "10";
      slideAside(
        others,
        shown,
        from,
        index(offset),
        room,
        horizontal ? "x" : "y",
      );
    },
    clear() {
      clearSlides(items);
      shown.fill(0);
    },
  };
}

/** Items in `container` marked `data-reorder-id`, dragged along one axis:
 *  the others slide aside as it passes them, and `onDrop` hears the place
 *  it was let go at (its index among them). */
export function reorderDrag(
  down: { button: number; clientX: number; clientY: number },
  {
    container,
    id,
    axis = "x",
    onDrop,
  }: {
    container: HTMLElement;
    id: string;
    axis?: "x" | "y";
    onDrop: (id: string, index: number) => void;
  },
): void {
  let line: Row | null = null;
  const start = axis === "x" ? down.clientX : down.clientY;
  const offset = (x: number, y: number) => (axis === "x" ? x : y) - start;
  const lifted = () =>
    container.querySelector<HTMLElement>(
      `[data-reorder-id="${CSS.escape(id)}"]`,
    );
  trackDrag(down, {
    start: () => {
      const style = getComputedStyle(container);
      line = row(
        [...container.querySelectorAll<HTMLElement>("[data-reorder-id]")].map(
          (node) => ({ id: node.dataset.reorderId ?? "", node }),
        ),
        id,
        {
          axis,
          gap: parseFloat(axis === "x" ? style.columnGap : style.rowGap) || 0,
        },
      );
      container.classList.add("is-reordering");
      lifted()?.classList.add("is-drag-lifted");
    },
    move: (x, y) => line?.move(offset(x, y)),
    end: (x, y, dropped) => {
      line?.clear();
      lifted()?.classList.remove("is-drag-lifted");
      container.classList.remove("is-reordering");
      if (!dropped || !line) return;
      const index = line.index(offset(x, y));
      if (index !== line.from) onDrop(id, index);
    },
  });
}
