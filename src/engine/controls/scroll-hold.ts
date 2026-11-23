import { STRETCHED_ATTR } from "./elastic-overscroll";

// Every way a scroller is kept where the reader has it while something
// else would move it: blocks drawn or let go above, a box resizing, a
// zoom (the webview's own scroll as the focus comes back is
// app/hold-on-return.ts). WebKit has no CSS scroll anchoring to do any of it.

/** Pulled past an end (macOS's rubber band, the system's or the page's
 *  own): the page is the hand's until it springs back, so nothing is
 *  drawn, let go or scrolled meanwhile - a block drawn, at its own height,
 *  and the page put back by it, cut the stretch short, and the page jumped
 *  between the two. */
export function pageIsTheHands(scroller: Element): boolean {
  if (scroller.hasAttribute(STRETCHED_ATTR)) return true;
  const top = scroller.scrollTop;
  return top < 0 || top > scroller.scrollHeight - scroller.clientHeight + 0.5;
}

/** Scrolls by `moved`, to the nearest whole pixel the scroll position
 *  takes; nothing for less than half of one, or while the page is the
 *  hand's. */
function scrollByHeld(scroller: Element, moved: number): void {
  if (pageIsTheHands(scroller) || Math.abs(moved) < 0.5) return;
  scroller.scrollTop = Math.round(scroller.scrollTop + moved);
}

/** An element on screen, and its top there before a change. */
export interface Still {
  el: Element;
  top: number;
}

/** Scrolls by what `still` moved. */
export function holdStill(scroller: Element, still: Still | null): void {
  if (pageIsTheHands(scroller) || !still?.el.isConnected) return;
  scrollByHeld(scroller, still.el.getBoundingClientRect().top - still.top);
}

/** By how much a scroller scrolls when a box that starts above its top
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

/** A box held by `holdOnResize`: its scroller, and whether a hand is
 *  resizing it (the page then moves as the hand does). */
interface Resizing {
  scroller: () => Element | null;
  byHand: () => boolean;
}

const heights = new WeakMap<Element, number>();
const resizing = new WeakMap<Element, Resizing>();
let observer: ResizeObserver | null = null;

// Scrolled before the frame is drawn: a ResizeObserver runs after layout
// and before paint.
function resized(entries: ResizeObserverEntry[]) {
  for (const { target } of entries) {
    const rect = target.getBoundingClientRect();
    const was = heights.get(target);
    heights.set(target, rect.height);
    const held = resizing.get(target);
    const scroller = held?.scroller();
    if (!scroller || held!.byHand()) continue;
    scrollByHeld(
      scroller,
      holdBy(was, rect.height, rect.top, scroller.getBoundingClientRect().top),
    );
  }
}

/** Keeps the page still while `el` changes size above the screen (a
 *  picture that loads, or turns into a missing card). The returned
 *  function stops it. */
export function holdOnResize(el: Element, held: Resizing): () => void {
  observer ??= new ResizeObserver(resized);
  resizing.set(el, held);
  observer.observe(el);
  return () => {
    observer?.unobserve(el);
    heights.delete(el);
    resizing.delete(el);
  };
}

/// The top-level block of `blocks` at viewport y `line`: the one it falls
/// in, else the first below it.
export function blockAt(blocks: Element, line: number): Element | null {
  for (const block of Array.from(blocks.children)) {
    if (block.getBoundingClientRect().bottom >= line) return block;
  }
  return null;
}

/// Runs `change`, anything that reflows the document, with the line at
/// viewport y `line` held still: `block` keeps the same share of its height there.
export function holdBlock(
  scroller: HTMLElement,
  block: Element,
  line: number,
  change: () => void,
) {
  const was = block.getBoundingClientRect();
  const share = was.height > 0 ? (line - was.top) / was.height : 0;
  change();
  const now = block.getBoundingClientRect();
  scroller.scrollTop += now.top + share * now.height - line;
}

/** A character on screen, and its top there before a change. */
export interface HeldText {
  range: Range;
  top: number;
}

/** The character of `within` drawn at viewport point (x, y), hit through
 *  any transform; null where no text is. */
export function textAt(within: Element, x: number, y: number): HeldText | null {
  const at = document.caretRangeFromPoint?.(x, y);
  const node = at?.startContainer;
  if (node?.nodeType !== Node.TEXT_NODE || !within.contains(node)) return null;
  const length = node.textContent?.length ?? 0;
  if (!length) return null;
  const from = Math.min(at!.startOffset, length - 1);
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, from + 1);
  const top = range.getClientRects()[0]?.top;
  return top === undefined ? null : { range, top };
}

/// Runs `change` with `held`'s line back where it was: text that rewraps
/// keeps its own line still, where a block's share of its height drifts.
export function holdText(
  scroller: HTMLElement,
  held: HeldText,
  change: () => void,
) {
  change();
  const now = held.range.getClientRects()[0];
  if (now) scroller.scrollTop += now.top - held.top;
}

/** `scroller` put back at `top` if something scrolled it; `then` hears
 *  that it was. */
export function putBack(scroller: HTMLElement, top: number, then?: () => void) {
  if (scroller.scrollTop === top) return;
  scroller.scrollTop = top;
  then?.();
}

/** `scroller` kept at `top` on the next frame: a scroll the engine makes
 *  meanwhile (WebKit putting its own selection back as an editor takes
 *  the focus, a pane re-measured after a zoom) is taken back. */
export function keepNextFrame(
  scroller: HTMLElement,
  top: number,
  then?: () => void,
): void {
  requestAnimationFrame(() => putBack(scroller, top, then));
}

/** Runs `change` (a focus) with `scroller` left where the reader has it,
 *  now and on the next frame. */
export function keepWhile(scroller: HTMLElement | null, change: () => void) {
  const top = scroller?.scrollTop;
  change();
  if (!scroller || top === undefined) return;
  putBack(scroller, top);
  keepNextFrame(scroller, top);
}
