import { motionAllowed } from "../ui/motion";

/** How far the page can be pulled past an end, at most. */
const MAX_PULL = 80;
/** How long after the last wheel event the page lets go. */
const RELEASE_MS = 120;
/** A wheel step this large is a mouse's notch or a hard flick, not a
 *  trackpad's finger; a Mac doesn't stretch the page for those. */
const MAX_TRACKPAD_DELTA = 60;
/** Wheel steps in a row that only shrink: the finger is off and macOS is
 *  sending the swipe's momentum, which it does for most of a second. */
const COASTING_STEPS = 4;
/** A pause between wheel events this long starts a new swipe. */
const NEW_SWIPE_MS = 80;

/**
 * The give a Mac page has at either end, for the document's own scroll
 * box: a swipe past the top or the bottom pulls the text after the finger,
 * harder the further it goes, and it springs back when the swipe ends.
 *
 * WKWebView doesn't stretch a scroll box inside the page - it hands the
 * overscroll to the page itself, which bounced the whole window, sidebar
 * and title bar along (held still since 1.2.0-rc.5,
 * document-view/ai-notice.css). So the stretch is drawn here, on
 * `content`'s `translate` (FLIP's glides use `transform`, which it
 * composes with), never its layout. Returns the cleanup.
 */
export function elasticOverscroll(
  scroller: HTMLElement,
  content: HTMLElement,
): () => void {
  // The finger's travel past the end (top: positive), and what is drawn.
  let travel = 0;
  let pull = 0;
  let release: number | undefined;
  let settling: Animation | null = null;
  // The swipe in progress: when its last step came, how big it was, how
  // many steps since have only shrunk, and whether its momentum bounced.
  let lastAt = -Infinity;
  let lastStep = 0;
  let shrinking = 0;
  let bounced = false;

  const draw = () => {
    pull =
      Math.sign(travel) *
      MAX_PULL *
      (1 - Math.exp(-Math.abs(travel) / MAX_PULL));
    content.style.translate = pull ? `0 ${pull.toFixed(1)}px` : "";
  };
  const letGo = () => {
    if (!pull) return;
    const from = `0 ${pull.toFixed(1)}px`;
    travel = 0;
    pull = 0;
    content.style.translate = "";
    settling = content.animate([{ translate: from }, { translate: "0 0" }], {
      duration: 360,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  };
  // Momentum that runs into an end bounces off it once, as far as it was
  // going fast.
  const bounce = (deltaY: number) => {
    const out =
      -Math.sign(deltaY) * Math.min(Math.abs(deltaY) * 4, MAX_PULL / 2);
    settling = content.animate(
      [{ translate: "0 0" }, { translate: `0 ${out}px` }, { translate: "0 0" }],
      { duration: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  };

  const onWheel = (e: WheelEvent) => {
    if (
      e.deltaMode !== 0 ||
      e.ctrlKey ||
      (e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY))
    )
      return;
    if (Math.abs(e.deltaY) > MAX_TRACKPAD_DELTA || !motionAllowed()) return;
    const now = performance.now();
    const step = Math.abs(e.deltaY);
    if (now - lastAt > NEW_SWIPE_MS) {
      shrinking = 0;
      bounced = false;
    } else if (step < lastStep || (step === lastStep && shrinking > 0)) {
      shrinking++;
    } else {
      shrinking = 0;
    }
    lastAt = now;
    lastStep = step;
    const coasting = shrinking >= COASTING_STEPS;
    const atTop = scroller.scrollTop <= 0;
    const atBottom =
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const pastEnd = (atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0);
    // Past an end it stretches; back the other way it gives the stretch
    // back first, before the box scrolls again.
    if (!pastEnd && travel === 0) return;
    // The finger has lifted: the text springs back now, rather than riding
    // the momentum out and hanging there until it ends.
    if (coasting) {
      window.clearTimeout(release);
      if (pull) letGo();
      else if (pastEnd && !bounced && !settling) bounce(e.deltaY);
      bounced = true;
      return;
    }
    settling?.cancel();
    settling = null;
    const next = travel - e.deltaY;
    travel = travel !== 0 && Math.sign(next) !== Math.sign(travel) ? 0 : next;
    draw();
    window.clearTimeout(release);
    release = window.setTimeout(letGo, RELEASE_MS);
  };

  scroller.addEventListener("wheel", onWheel, { passive: true });
  return () => {
    scroller.removeEventListener("wheel", onWheel);
    window.clearTimeout(release);
    settling?.cancel();
    content.style.translate = "";
  };
}
