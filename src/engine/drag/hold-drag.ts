import { canHaptic } from "../../platform/capabilities";
import { nativeFiles } from "../../platform/native-files";
import { DRAG_START_PX, TOUCH_SLOP_PX } from "../../utils/gesture";
import { trackDrag } from "./pointer-drag";

/** How long a finger holds still to lift what it is on. */
const HOLD_MS = 300;

interface HoldDragHandlers {
  /** Held long enough: it lifts, ready to drag. */
  lift?: () => void;
  move: (x: number, y: number, e: PointerEvent) => void;
  /** Let go after it moved (`dropped` false: cancelled). */
  end: (x: number, y: number, dropped: boolean, e?: PointerEvent) => void;
  /** Lifted and let go where it was: the long press's own answer (a menu). */
  held?: (x: number, y: number) => void;
}

/**
 * A finger's press that becomes a drag once it has held still `HOLD_MS`:
 * before that, a move is a scroll and the press is left alone. Lifted, the
 * finger carries it; let go without moving, it was a long press.
 */
export function holdToDrag(
  down: PointerEvent,
  handlers: HoldDragHandlers,
): void {
  const from = { x: down.clientX, y: down.clientY };
  const stop = () => {
    clearTimeout(timer);
    window.removeEventListener("pointermove", moved);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  const moved = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > TOUCH_SLOP_PX)
      stop();
  };
  const timer = setTimeout(() => {
    stop();
    if (canHaptic) nativeFiles.haptic();
    handlers.lift?.();
    let travelled = false;
    trackDrag(
      down,
      {
        move: (x, y, e) => {
          travelled ||= Math.hypot(x - from.x, y - from.y) >= DRAG_START_PX;
          if (travelled) handlers.move(x, y, e);
        },
        end: (x, y, dropped, e) => {
          if (!travelled && dropped && handlers.held) handlers.held(x, y);
          else handlers.end(x, y, travelled && dropped, e);
        },
      },
      { started: true },
    );
  }, HOLD_MS);
  window.addEventListener("pointermove", moved);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}
