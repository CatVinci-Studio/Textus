import { animate, motionAllowed } from "../motion/motion";
import { isIOSApp } from "../../platform/capabilities";
import { isMacPlatform } from "../../platform/os";
import { fingerDown, onTrackpadTouch } from "../../platform/trackpad";

/** On the scroll box while its content is pulled past an end or springs
 *  back: its scroll position doesn't say so (hold-still.ts). */
export const STRETCHED_ATTR = "data-stretched";
/** How far the page can be pulled past an end, at most. */
const MAX_PULL = 80;
/** With no word from the native side of the finger (trackpad.rs), how
 *  long after the last wheel event the page lets go. A finger held still
 *  sends nothing, so shorter springs back under a paused pull. */
const RELEASE_MS = 450;
/** A wheel step this large is a mouse's notch or a hard flick, not a
 *  trackpad's finger; a Mac doesn't stretch the page for those. */
const MAX_TRACKPAD_DELTA = 60;
/** Wheel steps in a row that only shrink: the finger is off and macOS is
 *  sending the swipe's momentum, which it does for most of a second. */
const COASTING_STEPS = 4;
/** A pause between wheel events this long starts a new swipe. */
const NEW_SWIPE_MS = 80;

/**
 * The give a Mac page has at either end, for the document's own scroll box.
 * WKWebView hands inner overscroll to the page, bouncing the whole window,
 * so the stretch is drawn here on `content`'s `translate`. Returns cleanup.
 */
export function elasticOverscroll(
  scroller: HTMLElement,
  content: HTMLElement,
): () => void {
  // Only a Mac: the iPhone's web view stretches by itself, Windows and Linux don't.
  if (!isMacPlatform() || isIOSApp) return () => {};
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

  const mark = () => {
    const on = pull !== 0 || settling !== null;
    if (on === scroller.hasAttribute(STRETCHED_ATTR)) return;
    scroller.toggleAttribute(STRETCHED_ATTR, on);
    // At rest again: what is on screen changed with no scroll, so those
    // waiting for one to end (the drawing of blocks) hear one.
    if (!on) scroller.dispatchEvent(new Event("scroll"));
  };
  const settle = (spring: Animation | null) => {
    settling = spring;
    if (spring)
      spring.onfinish = spring.oncancel = () => {
        if (settling !== spring) return;
        settling = null;
        mark();
      };
    mark();
  };
  // A spring under way stopped where it is now, its place taken up as the
  // finger's travel, so a new pull goes on from there without a jump.
  const stopSettling = () => {
    if (!settling) return;
    const now = parseFloat(
      (getComputedStyle(content).translate || "").split(" ")[1] ?? "",
    );
    const spring = settling;
    settling = null;
    spring.cancel();
    if (!Number.isFinite(now) || !now) return;
    const share = Math.min(Math.abs(now) / MAX_PULL, 0.99);
    travel = Math.sign(now) * -MAX_PULL * Math.log(1 - share);
  };
  const draw = () => {
    pull =
      Math.sign(travel) *
      MAX_PULL *
      (1 - Math.exp(-Math.abs(travel) / MAX_PULL));
    content.style.translate = pull ? `0 ${pull.toFixed(1)}px` : "";
    mark();
  };
  const letGo = () => {
    if (!pull) return;
    const from = `0 ${pull.toFixed(1)}px`;
    travel = 0;
    pull = 0;
    content.style.translate = "";
    settle(
      animate(content, [{ translate: from }, { translate: "0 0" }], {
        duration: "--dur-settle",
        easing: "--ease-out",
      }),
    );
  };
  // Momentum that runs into an end bounces off it once, as far as it was
  // going fast.
  const bounce = (deltaY: number) => {
    const out =
      -Math.sign(deltaY) * Math.min(Math.abs(deltaY) * 4, MAX_PULL / 2);
    settle(
      animate(
        content,
        [
          { translate: "0 0" },
          { translate: `0 ${out}px` },
          { translate: "0 0" },
        ],
        { duration: "--dur-land", easing: "--ease-out" },
      ),
    );
  };

  const onWheel = (e: WheelEvent) => {
    if (
      e.deltaMode !== 0 ||
      e.ctrlKey ||
      (e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY))
    )
      return;
    if (!motionAllowed()) return;
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
    // Shrinking steps are momentum only with no finger known to be down:
    // a held finger slowing as it pulls is still pulling.
    const coasting = fingerDown() !== true && shrinking >= COASTING_STEPS;
    // A large step stretches nothing unless it is a flick's momentum, which
    // bounces as it arrives rather than once it has slowed.
    if (step > MAX_TRACKPAD_DELTA && !coasting) return;
    const atTop = scroller.scrollTop <= 0;
    const atBottom =
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const pastEnd = (atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0);
    // Past an end it stretches; back the other way it gives the stretch
    // back first, before the box scrolls again.
    if (!pastEnd && travel === 0) return;
    // Lifted, as the native side says: what comes now is the swipe's
    // momentum, often after a pause that reads as a new swipe. It never
    // pulls the page out again; only once it is plainly coasting may it
    // bounce.
    if (fingerDown() === false && !coasting) return;
    // The finger has lifted: spring back now rather than ride the momentum.
    if (coasting) {
      window.clearTimeout(release);
      if (pull) letGo();
      else if (pastEnd && !bounced && !settling) bounce(e.deltaY);
      bounced = true;
      return;
    }
    stopSettling();
    const next = travel - e.deltaY;
    travel = travel !== 0 && Math.sign(next) !== Math.sign(travel) ? 0 : next;
    draw();
    window.clearTimeout(release);
    // The finger known to be down: it springs back when it lifts, held
    // still as long as it likes.
    if (fingerDown() !== true) release = window.setTimeout(letGo, RELEASE_MS);
  };

  scroller.addEventListener("wheel", onWheel, { passive: true });
  // Lifted: back at once, as a Mac page does.
  const offTouch = onTrackpadTouch((down) => {
    if (down) return;
    window.clearTimeout(release);
    letGo();
  });
  return () => {
    offTouch();
    scroller.removeEventListener("wheel", onWheel);
    window.clearTimeout(release);
    settling?.cancel();
    content.style.translate = "";
    scroller.removeAttribute(STRETCHED_ATTR);
  };
}
