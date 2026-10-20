import { motionAllowed } from "../ui/motion";

/** How far the page can be pulled past an end, at most. */
const MAX_PULL = 80;
/** How long after the last wheel event the page lets go. */
const RELEASE_MS = 120;
/** A wheel step this large is a mouse's notch or a hard flick, not a
 *  trackpad's finger; a Mac doesn't stretch the page for those. */
const MAX_TRACKPAD_DELTA = 60;

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

  const onWheel = (e: WheelEvent) => {
    if (
      e.deltaMode !== 0 ||
      e.ctrlKey ||
      (e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY))
    )
      return;
    if (Math.abs(e.deltaY) > MAX_TRACKPAD_DELTA || !motionAllowed()) return;
    const atTop = scroller.scrollTop <= 0;
    const atBottom =
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const pastEnd = (atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0);
    // Past an end it stretches; back the other way it gives the stretch
    // back first, before the box scrolls again.
    if (!pastEnd && travel === 0) return;
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
