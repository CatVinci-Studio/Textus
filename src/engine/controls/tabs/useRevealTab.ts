import { useEffect, useRef, type RefObject } from "react";
import { scrollBehavior } from "../../motion/motion";
import { scaledPx } from "../../tokens/chrome-scale";
import { revealAt, snapToTab, type Slot } from "./tab-strip";
import { revealOnResize } from "./reveal-on-resize";

/** The fade over a scrolled row's start (island.css). */
const TAB_FADE = 36;

/** Where the open tab is laid out, and the row's room for it. */
interface TabPlace {
  slotX: number | undefined;
  slotW: number | undefined;
  shownLength: number | null | undefined;
  /** A touch row's tab starts, which it scrolls to. */
  edges: readonly number[] | null;
}

/** The open tab kept in view as it changes, and as the row resizes:
 *  smoothly to a newly opened tab, at once otherwise. */
export function useRevealTab(
  barRef: RefObject<HTMLDivElement | null>,
  stripEl: RefObject<HTMLDivElement | null>,
  activeTabId: string,
  place: TabPlace,
): void {
  const { slotX, slotW, shownLength } = place;
  const smooth = useRef<string | null>(null);
  const placed = useRef(place);
  placed.current = place;
  useEffect(() => {
    const bar = barRef.current;
    const revealNow = (smoothly: boolean) => {
      const { slotX: x, slotW: w, shownLength: shown } = placed.current;
      if (!bar || x === undefined || w === undefined || shown == null) return;
      reveal(bar, { x, w }, shown, smoothly, placed.current.edges);
    };
    if (!bar || slotX === undefined || slotW === undefined) return;
    if (shownLength === null) return;
    const smoothly = smooth.current !== activeTabId;
    smooth.current = activeTabId;
    revealNow(smoothly);
    // Again once the row is measured, as smoothly the first time: the
    // reveal may have run while it still had its old width.
    let first = smoothly;
    return revealOnResize([bar, stripEl.current], () => {
      revealNow(first);
      first = false;
    });
  }, [barRef, stripEl, activeTabId, slotX, slotW, shownLength]);
}

/**
 * Scrolls the row alone (never the page) to bring `slot` into the part of
 * it that shows, `shown` long from where it is scrolled to.
 */
function reveal(
  bar: HTMLElement,
  slot: Slot,
  shown: number,
  smooth: boolean,
  /** A touch row's tab starts, which it scrolls to. */
  edges: readonly number[] | null,
): void {
  // A touch row lists its tabs (⌄) and swipes: no faded part of the tab
  // before the open one, which reads as a stray sliver there.
  const fade = edges ? 0 : scaledPx(TAB_FADE);
  // A row barely wider than the tab (a phone's) fades only what is left
  // beside it: never the tab's own first letters.
  const room = Math.min(fade, Math.max(0, shown - slot.w));
  bar.style.setProperty("--tab-fade", `${room}px`);
  let left = revealAt(slot, bar.scrollLeft, shown, fade, edges ? 0 : 12);
  if (edges) {
    const snapped = snapToTab(left ?? bar.scrollLeft, edges, slot.x);
    left = Math.abs(snapped - bar.scrollLeft) < 1 ? null : snapped;
  }
  if (left !== null)
    bar.scrollTo({ left, behavior: smooth ? scrollBehavior() : "auto" });
}
