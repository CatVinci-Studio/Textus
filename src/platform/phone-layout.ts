import { isMobileApp } from "./capabilities";
import { UI_SIZE_NAMES, UI_TEXT_SCALES } from "../prefs/settings-values";

/** The width at which a phone or tablet app takes the phone's layout: one
 *  island, the rail and sidebar pushed in from the left. Wider (a tablet,
 *  an unfolded phone), it is the desktop's. */
const PHONE_WIDTH = 760;
const PHONE_QUERY = `(max-width: ${PHONE_WIDTH}px)`;

/** A screen whose short side is under this is a phone's, turned either way.
 *  The screen's, not the window's: the keyboard shortens the web view. */
const PHONE_SHORT_SIDE = 600;

/** How much wider the interface's own units make the phone's width: at the
 *  two steps past Large an upright iPad is a phone's width in its units
 *  (its sidebar left the document a strip), smaller steps keep the width. */
function grown(): number {
  const step = document.documentElement.dataset.uiSize ?? "";
  const scale = UI_TEXT_SCALES[UI_SIZE_NAMES.indexOf(step)] ?? 1;
  return scale > 1.25 ? scale : 1;
}

/** Whether the phone's layout is in use now. Never on a desktop: a narrow
 *  desktop window is still a desktop. */
export function isPhoneLayout(): boolean {
  if (!isMobileApp) return false;
  const short = Math.min(screen.width, screen.height);
  return (
    (short > 0 && short < PHONE_SHORT_SIDE) ||
    (window.matchMedia?.(PHONE_QUERY).matches ?? false) ||
    (grown() > 1 && window.innerWidth <= PHONE_WIDTH * grown())
  );
}

/** Calls `changed` as the layout crosses the phone's: rotation, split
 *  screen, a foldable opened, an Interface Size step; returns the stop. */
export function onPhoneLayout(changed: () => void): () => void {
  let was = isPhoneLayout();
  const check = () => {
    const now = isPhoneLayout();
    if (now === was) return;
    was = now;
    changed();
  };
  window.addEventListener("resize", check);
  const step = new MutationObserver(check);
  step.observe(document.documentElement, { attributeFilter: ["data-ui-size"] });
  return () => {
    window.removeEventListener("resize", check);
    step.disconnect();
  };
}
