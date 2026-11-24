import { isMobileApp } from "./capabilities";

/** The width at which a phone or tablet app takes the phone's layout: one
 *  island, the rail and sidebar pushed in from the left. Wider (a tablet,
 *  an unfolded phone), it is the desktop's. */
const PHONE_QUERY = "(max-width: 760px)";

/** A screen whose short side is under this is a phone's, turned either way.
 *  The screen's, not the window's: the keyboard shortens the web view. */
const PHONE_SHORT_SIDE = 600;

/** Whether the phone's layout is in use now. Never on a desktop: a narrow
 *  desktop window is still a desktop. */
export function isPhoneLayout(): boolean {
  if (!isMobileApp) return false;
  const short = Math.min(screen.width, screen.height);
  return (
    (short > 0 && short < PHONE_SHORT_SIDE) ||
    (window.matchMedia?.(PHONE_QUERY).matches ?? false)
  );
}

/** Calls `changed` as the screen crosses the phone's width (rotation, split
 *  screen, a foldable opened); returns the stop. */
export function onPhoneLayout(changed: () => void): () => void {
  const mq = window.matchMedia?.(PHONE_QUERY);
  mq?.addEventListener("change", changed);
  return () => mq?.removeEventListener("change", changed);
}
