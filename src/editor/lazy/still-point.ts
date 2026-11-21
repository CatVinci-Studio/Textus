import type { Still } from "../../engine/controls/scroll-hold";
import { PENDING_ATTR, PLACEHOLDER_CLASS } from "./lazy-rules";

// What the reader sees stays where it is while blocks or views above it
// are drawn or let go: the block it is held by (engine/controls/scroll-hold).

/** The first child of `children` whose bottom is below `y`, by binary
 *  search: their tops only grow down the document. One not shown (a
 *  diagram's hidden source) has no place, so the next shown one stands in. */
export function firstBelow(children: HTMLCollection, y: number): number {
  let low = 0;
  let high = children.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    let at = mid;
    let rect = children[at]!.getBoundingClientRect();
    while (!rect.width && !rect.height && at + 1 < high)
      rect = children[++at]!.getBoundingClientRect();
    if (!rect.width && !rect.height) high = mid;
    else if (rect.bottom < y) low = at + 1;
    else high = mid;
  }
  return low;
}

/** Changes as it is drawn: a placeholder, or a view still waiting. */
const changes = (el: Element) =>
  el.classList.contains(PLACEHOLDER_CLASS) ||
  el.hasAttribute(PENDING_ATTR) ||
  !!el.querySelector(`[${PENDING_ATTR}]`);

/**
 * The block on screen that holds still: one drawn, below the last that is
 * about to change, since what scrolls in fresh is at that end (scrolling up,
 * the top); the first drawn one when nothing below is; the first on screen
 * when none is drawn yet (a screen of placeholders).
 */
export function stillPoint(root: Element, scroller: Element): Still | null {
  const box = scroller.getBoundingClientRect();
  if (!box.height) return null;
  const children = root.children;
  let any: Still | null = null;
  let first: Still | null = null;
  let below: Still | null = null;
  for (let i = firstBelow(children, box.top); i < children.length; i++) {
    const el = children[i]!;
    const rect = el.getBoundingClientRect();
    if (rect.top > box.bottom) break;
    if (!rect.height) continue;
    any ??= { el, top: rect.top };
    if (changes(el)) below = null;
    // A widget (a drawn formula) may be made anew as the blocks beside it
    // are: only blocks hold still.
    else if (!el.classList.contains("ProseMirror-widget")) {
      first ??= { el, top: rect.top };
      below ??= { el, top: rect.top };
    }
  }
  return below ?? first ?? any;
}
