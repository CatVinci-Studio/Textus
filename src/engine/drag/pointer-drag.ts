import { DRAG_START_PX } from "../../utils/gesture";
// Dragging with pointer events, not HTML drag and drop: the window's own
// file drop takes that over (macOS shows a copy cursor, nothing lands). A
// press becomes a drag once it moves DRAG_START_PX; letting go ends it, Esc
// or a cancelled pointer drops nothing. What the drag means is the caller's.

interface DragHandlers {
  /** The press moved far enough: the drag begins. */
  start?: (x: number, y: number) => void;
  move: (x: number, y: number, e: PointerEvent) => void;
  /** `dropped`: let go (false: Esc, a cancelled pointer, or cancel()). */
  end: (x: number, y: number, dropped: boolean, e?: PointerEvent) => void;
}

/** Follows a press from `down`; a click after a drag is swallowed.
 *  `started`: already a drag (one handed over mid-move), from the first
 *  move on. Returns the handle that ends it, dropping nothing. */
export function trackDrag(
  down: { button: number; clientX: number; clientY: number },
  handlers: DragHandlers,
  { started = false }: { started?: boolean } = {},
): { cancel: () => void } {
  const idle = { cancel: () => {} };
  if (!started && down.button !== 0) return idle;
  const from = { x: down.clientX, y: down.clientY };
  const last = { ...from };
  let dragging = started;
  let done = false;
  const move = (e: PointerEvent) => {
    // A release WebView2 never told: the buttons are up.
    if (e.buttons === 0) return finish(e.clientX, e.clientY, true, e);
    last.x = e.clientX;
    last.y = e.clientY;
    if (!dragging) {
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_START_PX)
        return;
      dragging = true;
      handlers.start?.(from.x, from.y);
    }
    e.preventDefault();
    handlers.move(e.clientX, e.clientY, e);
  };
  const finish = (x: number, y: number, dropped: boolean, e?: PointerEvent) => {
    if (done) return;
    done = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    if (!dragging) return;
    handlers.end(x, y, dropped, e);
    swallowClick();
  };
  const up = (e: PointerEvent) => finish(e.clientX, e.clientY, true, e);
  const cancel = (e: PointerEvent) => finish(e.clientX, e.clientY, false, e);
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !dragging) return;
    e.preventDefault();
    finish(from.x, from.y, false);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
  return { cancel: () => finish(last.x, last.y, false) };
}

/** The click a release sends lands on what was dragged: it isn't one. */
function swallowClick() {
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  // The window as it is now: the page may be gone by the time this runs.
  const win = window;
  win.addEventListener("click", stop, { capture: true, once: true });
  win.setTimeout(() => win.removeEventListener("click", stop, true), 0);
}
