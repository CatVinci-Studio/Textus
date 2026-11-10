import type { MouseEvent, PointerEvent, TouchEvent } from "react";

/** How far a finger may travel and still be tapping rather than scrolling
 *  the list under it (UIKit's own slop is about this). */
const TAP_SLOP = 10;

/** Where each touch began, per element: kept outside the props so a
 *  re-render while the finger is down doesn't forget it. */
const touchStarts = new WeakMap<Element, { x: number; y: number }>();

function rememberTouchStart(e: TouchEvent) {
  const touch = e.touches[0];
  if (touch)
    touchStarts.set(e.currentTarget, { x: touch.clientX, y: touch.clientY });
}

/** Whether the touch ending now stayed within the slop of where it began -
 *  a tap, not a swipe that scrolled whatever is under the finger. */
function endedAsTap(e: TouchEvent): boolean {
  const start = touchStarts.get(e.currentTarget);
  touchStarts.delete(e.currentTarget);
  const touch = e.changedTouches[0];
  if (!start || !touch) return false;
  return (
    Math.hypot(touch.clientX - start.x, touch.clientY - start.y) <= TAP_SLOP
  );
}

/** Props that run `action` on a press without taking focus from the field
 *  being typed in. The touchend is cancelled so WebKit synthesises no second
 *  click; a touch that moved is a scroll, not a pick. */
export function tapKeepingFocus(action: () => void) {
  return {
    onMouseDown: (e: MouseEvent) => {
      e.preventDefault();
      action();
    },
    onTouchStart: rememberTouchStart,
    onTouchEnd: (e: TouchEvent) => {
      if (!endedAsTap(e)) return;
      e.preventDefault();
      action();
    },
  };
}

/** Props for a button in a strip that keeps the editor's focus. Like
 *  `tapKeepingFocus`, but a mouse or keyboard runs it on click, and a
 *  finger's touchend is cancelled even when it moved, since the strip scrolls. */
export function pressKeepingFocus(action: () => void) {
  return {
    // The default of pointerdown is what moves focus to the button.
    onPointerDown: (e: PointerEvent) => e.preventDefault(),
    onTouchStart: rememberTouchStart,
    onTouchEnd: (e: TouchEvent) => {
      const tap = endedAsTap(e);
      // Once the strip is scrolling the event can't be cancelled (and
      // WebKit synthesises no click after a scroll anyway).
      if (e.cancelable) e.preventDefault();
      if (tap) action();
    },
    onClick: action,
  };
}
