import { useRef, type MouseEvent, type PointerEvent } from "react";
import { DRAG_START_PX } from "../../utils/gesture";

/** Let go this soon where it was pressed, a press only opened the list. */
const STRAY_MS = 300;

/**
 * A menu's or select's trigger opening on the mouse's press, as the
 * system's do, rather than on its click: `onPointerDown` calls `toggle`
 * (which says whether it opened), and `ownClick` tells the click that
 * follows from the same press, which must not toggle again. A finger and
 * the keys still go by the click. Held and let go over one of the list's
 * `rows`, the press chooses that row.
 */
export function usePressOpen(
  toggle: (trigger: HTMLElement) => boolean,
  rows: string,
) {
  const pressed = useRef(false);
  return {
    onPointerDown(e: PointerEvent) {
      // A Mac's Ctrl-click is a right-click: left to the click, as before.
      pressed.current =
        e.pointerType === "mouse" &&
        e.button === 0 &&
        !e.ctrlKey &&
        !(e.currentTarget as HTMLButtonElement).disabled;
      if (pressed.current && toggle(e.currentTarget as HTMLElement))
        chooseOnRelease(e, rows);
    },
    /** For a trigger whose list takes the focus as it opens: the press's
     *  mousedown, which comes after, must not hand it back to the trigger. */
    keepFocus(e: MouseEvent) {
      if (pressed.current) e.preventDefault();
    },
    /** This click is the press's own, already answered. */
    ownClick(e: MouseEvent): boolean {
      // detail 0: Enter or Space, which never follows a press.
      const own = pressed.current && e.detail !== 0;
      pressed.current = false;
      return own;
    },
  };
}

/** The press's release over one of `rows` clicks it: a mouse has no capture,
 *  so the release lands on the row, whose own click never fires (it was
 *  pressed elsewhere). Not when let go at once where it was pressed. */
function chooseOnRelease(down: PointerEvent, rows: string) {
  const start = performance.now();
  const from = { x: down.clientX, y: down.clientY };
  const done = () => {
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", done, true);
    window.removeEventListener("pointerdown", done, true);
  };
  const up = (e: globalThis.PointerEvent) => {
    done();
    const still =
      Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_START_PX;
    if (still && performance.now() - start < STRAY_MS) return;
    const row =
      e.target instanceof Element ? e.target.closest<HTMLElement>(rows) : null;
    if (row && row.getAttribute("aria-disabled") !== "true") row.click();
  };
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", done, true);
  // A release lost outside the window: the next press starts afresh. Added
  // during this press, so its own capture phase has passed.
  window.addEventListener("pointerdown", done, true);
}
