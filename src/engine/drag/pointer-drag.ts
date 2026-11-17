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
  down: {
    button: number;
    clientX: number;
    clientY: number;
    target?: EventTarget | null;
  },
  handlers: DragHandlers,
  { started = false }: { started?: boolean } = {},
): { cancel: () => void } {
  const idle = { cancel: () => {} };
  if (!started && down.button !== 0) return idle;
  const from = { x: down.clientX, y: down.clientY };
  const last = { ...from };
  let dragging = started;
  let done = false;
  // A finger's events stay with the node it pressed, also once that node
  // leaves the page (a pulled tab's pill): they no longer reach the window.
  const origin = down.target instanceof Node ? down.target : null;
  const heard = new WeakSet<Event>();
  const once =
    <E extends Event>(handle: (e: E) => void) =>
    (e: E) => {
      if (heard.has(e)) return;
      heard.add(e);
      handle(e);
    };
  const move = once((e: PointerEvent) => {
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
  });
  // Nor does the web view pan under a drag whose node is gone.
  const hold = (e: Event) => dragging && e.cancelable && e.preventDefault();
  const finish = (x: number, y: number, dropped: boolean, e?: PointerEvent) => {
    if (done) return;
    done = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("pointerdown", pressed, true);
    for (const [type, fn] of onOrigin) origin?.removeEventListener(type, fn);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("contextmenu", noMenu, true);
    if (!dragging) return;
    handlers.end(x, y, dropped, e);
    swallowClick();
  };
  const up = once((e: PointerEvent) => finish(e.clientX, e.clientY, true, e));
  const cancel = once((e: PointerEvent) =>
    finish(e.clientX, e.clientY, false, e),
  );
  // A new press while this one is still followed: its release went
  // unheard, and the drag ends where it was, dropping nothing.
  const pressed = (e: PointerEvent) => finish(last.x, last.y, false, e);
  const onOrigin = [
    ["pointermove", move],
    ["pointerup", up],
    ["pointercancel", cancel],
    ["touchmove", hold],
  ] as [string, EventListener][];
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !dragging) return;
    e.preventDefault();
    finish(from.x, from.y, false);
  };
  // A finger held still a moment is a long press to Android's web view: its
  // menu would take the touch over, and the lift would never come.
  const noMenu = (e: Event) => e.preventDefault();
  window.addEventListener("contextmenu", noMenu, true);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("pointerdown", pressed, true);
  for (const [type, fn] of onOrigin)
    origin?.addEventListener(type, fn, { passive: false });
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
