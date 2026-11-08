// Dragging with pointer events, not HTML drag and drop: the window's own
// file drop takes that over (macOS shows a copy cursor, nothing lands). A
// press becomes a drag once it moves DRAG_START_PX; letting go ends it, Esc
// or a cancelled pointer drops nothing. What the drag means is the caller's.

export const DRAG_START_PX = 5;

/** One slide for every item making way, so overlapping moves read as one. */
export const SLIDE =
  "transform calc(var(--dur-base) * var(--motion-travel)) var(--ease-in-out)";

export interface DragHandlers {
  /** The press moved far enough: the drag begins. */
  start?: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  /** `dropped`: let go (false: Esc or a cancelled pointer). */
  end: (x: number, y: number, dropped: boolean) => void;
}

/** Follows a press from `down`; a click after a drag is swallowed. */
export function trackDrag(
  down: { button: number; clientX: number; clientY: number },
  handlers: DragHandlers,
): void {
  if (down.button !== 0) return;
  const from = { x: down.clientX, y: down.clientY };
  let dragging = false;
  const move = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_START_PX)
        return;
      dragging = true;
      handlers.start?.(from.x, from.y);
    }
    e.preventDefault();
    handlers.move(e.clientX, e.clientY);
  };
  const finish = (x: number, y: number, dropped: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    if (!dragging) return;
    handlers.end(x, y, dropped);
    swallowClick();
  };
  const up = (e: PointerEvent) => finish(e.clientX, e.clientY, true);
  const cancel = (e: PointerEvent) => finish(e.clientX, e.clientY, false);
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !dragging) return;
    e.preventDefault();
    finish(from.x, from.y, false);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}

/** The click a release sends lands on what was dragged: it isn't one. */
function swallowClick() {
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", stop, true), 0);
}

/** An item along a row or column, measured once when the drag starts. */
export interface Slot {
  id: string;
  center: number;
  size: number;
}

/** Where `id` lands with its center moved by `offset`: how many of the
 *  others it has passed. */
export function dropIndex(
  slots: readonly Slot[],
  id: string,
  offset: number,
): number {
  const mine = slots.find((s) => s.id === id);
  if (!mine) return -1;
  const center = mine.center + offset;
  return slots.filter((s) => s.id !== id && s.center < center).length;
}

/** How far each other item moves to make room: one slot back or forward
 *  for each the dragged one has passed. */
export function makeRoom(
  slots: readonly Slot[],
  id: string,
  offset: number,
  gap: number,
): Map<string, number> {
  const mine = slots.find((s) => s.id === id);
  const shifts = new Map<string, number>();
  if (!mine) return shifts;
  const center = mine.center + offset;
  const room = mine.size + gap;
  for (const s of slots) {
    if (s.id === id) continue;
    if (s.center < mine.center && center < s.center) shifts.set(s.id, room);
    else if (s.center > mine.center && center > s.center)
      shifts.set(s.id, -room);
  }
  return shifts;
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
  const nodes = () => [
    ...container.querySelectorAll<HTMLElement>("[data-reorder-id]"),
  ];
  const translate = axis === "x" ? "translateX" : "translateY";
  let slots: Slot[] = [];
  let gap = 0;
  const start = axis === "x" ? down.clientX : down.clientY;
  const clear = () => {
    for (const n of nodes()) {
      n.style.transition = "";
      n.style.transform = "";
      n.style.zIndex = "";
      n.classList.remove("is-drag-lifted");
    }
    container.classList.remove("is-reordering");
  };
  trackDrag(down, {
    start: () => {
      slots = nodes().map((n) => ({
        id: n.dataset.reorderId ?? "",
        // Layout values, untouched by transforms in flight.
        center:
          axis === "x"
            ? n.offsetLeft + n.offsetWidth / 2
            : n.offsetTop + n.offsetHeight / 2,
        size: axis === "x" ? n.offsetWidth : n.offsetHeight,
      }));
      const style = getComputedStyle(container);
      gap = parseFloat(axis === "x" ? style.columnGap : style.rowGap) || 0;
      container.classList.add("is-reordering");
    },
    move: (x, y) => {
      const offset = (axis === "x" ? x : y) - start;
      const shifts = makeRoom(slots, id, offset, gap);
      for (const n of nodes()) {
        const nid = n.dataset.reorderId ?? "";
        if (nid === id) {
          n.style.transition = "none";
          n.style.transform = `${translate}(${offset}px)`;
          n.style.zIndex = "10";
          n.classList.add("is-drag-lifted");
        } else {
          const shift = shifts.get(nid) ?? 0;
          n.style.transition = SLIDE;
          n.style.transform = shift ? `${translate}(${shift}px)` : "";
        }
      }
    },
    end: (x, y, dropped) => {
      clear();
      if (!dropped) return;
      const index = dropIndex(slots, id, (axis === "x" ? x : y) - start);
      const from = slots.findIndex((s) => s.id === id);
      if (index >= 0 && index !== from) onDrop(id, index);
    },
  });
}
