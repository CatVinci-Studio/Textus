import { pastAnEnd } from "./hold-still";

// A picture that loads, or turns into a missing card, above what the reader
// sees would push it down: the page scrolls by what it grew instead,
// before the frame is drawn (a ResizeObserver runs after layout and before
// paint). WebKit has no scroll anchoring to do it.

const SCROLLER = ".editor-scroll";
const HELD = ".image-view-resizing";
const heights = new WeakMap<Element, number>();
let observer: ResizeObserver | null = null;

/** By how much `scroller` scrolls when a box that starts above its top
 *  (`top` < `scrollerTop`) goes from `was` to `now` tall: the change, so
 *  what is below holds still. Nothing for one on screen or below it. */
export function holdBy(
  was: number | undefined,
  now: number,
  top: number,
  scrollerTop: number,
): number {
  if (was === undefined || Math.abs(now - was) < 0.5) return 0;
  return top < scrollerTop ? now - was : 0;
}

function resized(entries: ResizeObserverEntry[]) {
  for (const { target } of entries) {
    const rect = target.getBoundingClientRect();
    const was = heights.get(target);
    heights.set(target, rect.height);
    const scroller = target.closest(SCROLLER);
    // A picture resized by hand moves the page as the hand does.
    if (!scroller || pastAnEnd(scroller) || target.matches(HELD)) continue;
    const by = holdBy(
      was,
      rect.height,
      rect.top,
      scroller.getBoundingClientRect().top,
    );
    if (by) scroller.scrollTop = Math.round(scroller.scrollTop + by);
  }
}

/** Keeps the page still while `el` changes size above the screen. The
 *  returned function stops it. */
export function holdOnResize(el: Element): () => void {
  observer ??= new ResizeObserver(resized);
  observer.observe(el);
  return () => {
    observer?.unobserve(el);
    heights.delete(el);
  };
}
