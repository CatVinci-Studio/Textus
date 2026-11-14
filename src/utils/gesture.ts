/** How far a pressed mouse or pen moves before the press becomes a drag. */
export const DRAG_START_PX = 5;

/** How far a finger may travel and still be tapping or holding rather than
 *  scrolling (UIKit's own slop is about this). */
export const TOUCH_SLOP_PX = 10;

let lastTouch = 0;
if (typeof window !== "undefined")
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "touch") lastTouch = e.timeStamp;
    },
    true,
  );

/**
 * Whether a contextmenu came from a finger held down (Android's WebView
 * sends one; WebKit doesn't): the system's own selection and the app's touch
 * menus answer that, not the mouse's right-click menu.
 */
export function heldByFinger(e: Event): boolean {
  const type = (e as PointerEvent).pointerType;
  if (type) return type === "touch";
  return lastTouch > 0 && e.timeStamp - lastTouch < 1500;
}
