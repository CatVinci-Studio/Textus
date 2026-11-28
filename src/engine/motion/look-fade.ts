import { createSubscribers } from "../../utils/store";
import { LOOK_FADING } from "../tokens/appearance";
import { motionAllowed } from "./motion";

/**
 * A change of the whole window's look - a theme, light or dark - cross-fades
 * the window over --dur-theme where the engine has view transitions and
 * motion is allowed. Elsewhere (older WebKit and WebView2, reduced motion)
 * it lands in one frame, as theme/restyle-hold.ts makes it.
 *
 * The browser takes one picture of the page as it was, makes the change,
 * and fades that picture out over the live page. Only the root is pictured
 * (nothing here names a view-transition-name), so islands keep their order
 * and their clipping, and the page under the picture keeps running: the
 * frame clock and every animation go on as if nothing covered them.
 */

/** Changes waiting for the old picture: they all land in one fade. */
let waiting: (() => void)[] | null = null;
let fading: ViewTransition | null = null;
let changing = false;

/** Whether a change of look made now would cross-fade. Not from inside a
 *  fade's own change: that lands in the picture already being shown. */
export function lookCanFade(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !changing &&
    motionAllowed()
  );
}

function runAll(changes: (() => void)[]): void {
  changing = true;
  try {
    for (const change of changes) {
      // One that throws leaves the rest to land, and is still told.
      try {
        change();
      } catch (error) {
        console.error(error);
      }
    }
  } finally {
    changing = false;
  }
}

/** Makes `change` - one that changes the window's look - inside a
 *  cross-fade where one can run, else at once. A second change before the
 *  old picture is taken joins the same fade; one after it ends the fade
 *  running and starts its own from where the page then is. */
export function fadeLook(change: () => void): void {
  if (waiting) {
    waiting.push(change);
    return;
  }
  if (!lookCanFade()) {
    change();
    return;
  }
  fading?.skipTransition();
  const root = document.documentElement;
  const changes = [change];
  waiting = changes;
  // Clicks wait till the picture is gone: they would land on controls the
  // user doesn't see yet (base.css).
  root.setAttribute(LOOK_FADING, "");
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(() => {
      waiting = null;
      runAll(changes);
    });
  } catch {
    waiting = null;
    root.removeAttribute(LOOK_FADING);
    runAll(changes);
    return;
  }
  fading = transition;
  // Skipped (a later change, a hidden window): not an error.
  transition.ready.catch(() => {});
  void transition.finished
    .catch(() => {})
    .then(() => {
      if (fading !== transition) return;
      fading = null;
      root.removeAttribute(LOOK_FADING);
    });
}

const DARK = "(prefers-color-scheme: dark)";

const scheme = createSubscribers(watchScheme);

/** The system's light or dark flipping, heard once for every listener. A
 *  window that follows the system (no data-theme) cross-fades as a theme
 *  picked does: by the time the flip is heard the media query has already
 *  turned, so the old look is held for the fade's first picture by naming
 *  it, and let go inside the fade, where the listeners re-pick too. */
function watchScheme(): () => void {
  const dark = window.matchMedia(DARK);
  const flip = () => {
    const root = document.documentElement;
    if (root.hasAttribute("data-theme") || !lookCanFade()) {
      scheme.publish();
      return;
    }
    const was = dark.matches ? "light" : "dark";
    root.setAttribute("data-theme", was);
    fadeLook(() => {
      // Unless a theme picked meanwhile set its own.
      if (root.getAttribute("data-theme") === was)
        root.removeAttribute("data-theme");
      scheme.publish();
    });
  };
  dark.addEventListener?.("change", flip);
  return () => dark.removeEventListener?.("change", flip);
}

/** Calls `listener` when the system's light or dark flips, inside the
 *  window's cross-fade when there is one. Returns the function that stops. */
export function onSystemScheme(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  return scheme.subscribe(listener);
}

/** Keeps the system's flips heard while the window is open, so each one
 *  fades even with no imported theme listening. */
export const fadeSystemSchemeFlips = (): (() => void) =>
  onSystemScheme(() => {});
