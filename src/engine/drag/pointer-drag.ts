import { DRAG_START_PX } from "../../utils/gesture";
// Dragging with pointer events, not HTML drag and drop: the window's own
// file drop takes that over (macOS shows a copy cursor, nothing lands). A
// press becomes a drag once it moves DRAG_START_PX; letting go ends it, Esc
// or a cancelled pointer drops nothing. What the drag means is the caller's.

interface DragHandlers {
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
