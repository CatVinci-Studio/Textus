import { duration, motionAllowed } from "./motion";

/**
 * A change the user makes to the whole window's look - a theme, light,
 * dark or the system's - cross-fades the window over --dur-theme where the
 * engine has view transitions and motion is allowed. Elsewhere (older
 * WebKit and WebView2, reduced motion) it lands in one frame, as
 * theme/restyle-hold.ts makes it. The system flipping light or dark on its
 * own is left to the system, which fades the whole screen itself.
 *
 * The browser takes one picture of the page as it was, makes the change,
 * and fades that picture out over the live page; its overlay takes the
 * clicks meanwhile. Only the root is pictured (nothing here names a
 * view-transition-name), so islands keep their order and their clipping,
 * and the page under the picture keeps running: the frame clock and every
 * animation go on as if nothing covered them.
 */

/** Changes waiting for the old picture: they all land in one fade. */
let waiting: (() => void)[] | null = null;
let fading: ViewTransition | null = null;
/** What the change being made is still loading, while it is made. */
let held: Promise<unknown>[] | null = null;

/** Whether a change of look made now would cross-fade. Always while a
 *  fade waits for its picture: made at once, the change would land before
 *  the ones asked for first, and they would undo it. Not from inside a
 *  fade's own change: that lands in the picture already being shown. */
export function lookCanFade(): boolean {
  if (waiting) return true;
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !held &&
    motionAllowed()
  );
}

/** Called while a change of look is made: the old picture stays until
 *  `until` settles (a theme's stylesheet being read), for at most
 *  --dur-slow, after which the fade goes on and the rest lands as it
 *  comes. Outside a fade, nothing waits. */
export function holdLook(until: Promise<unknown>): void {
  held?.push(until);
}

/** Runs the changes; resolves once what they still load has come, or the
 *  wait is over. */
function runAll(changes: (() => void)[]): Promise<void> | void {
  const loading: Promise<unknown>[] = [];
  held = loading;
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
    held = null;
  }
  if (!loading.length) return;
  const cap = new Promise((done) => setTimeout(done, duration("--dur-slow")));
  return Promise.race([Promise.allSettled(loading), cap]).then(() => {});
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
  const changes = [change];
  waiting = changes;
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(() => {
      waiting = null;
      return runAll(changes);
    });
  } catch {
    waiting = null;
    void runAll(changes);
    return;
  }
  fading = transition;
  // Skipped (a later change, a hidden window): not an error.
  transition.ready.catch(() => {});
  void transition.finished
    .catch(() => {})
    .then(() => {
      if (fading === transition) fading = null;
    });
}
