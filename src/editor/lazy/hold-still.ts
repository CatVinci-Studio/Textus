import { PENDING_ATTR, PLACEHOLDER_CLASS } from "./lazy-rules";

// What the reader sees stays where it is while blocks or views above it
// are drawn or let go: WebKit has no CSS scroll anchoring to do it.

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

interface Still {
  el: Element;
  top: number;
}

/** The first of the editor's blocks on screen that is drawn: a
 *  placeholder, or a view still waiting, changes as it is drawn. */
export function stillPoint(root: Element, scroller: Element): Still | null {
  const box = scroller.getBoundingClientRect();
  if (!box.height) return null;
  const children = root.children;
  for (let i = firstBelow(children, box.top); i < children.length; i++) {
    const el = children[i]!;
    const rect = el.getBoundingClientRect();
    if (rect.top > box.bottom) break;
    if (!rect.height || el.classList.contains(PLACEHOLDER_CLASS)) continue;
    if (el.hasAttribute(PENDING_ATTR)) continue;
    return { el, top: rect.top };
  }
  return null;
}

/** Scrolls by what `still` moved. */
export function holdStill(scroller: Element, still: Still | null): void {
  if (!still?.el.isConnected) return;
  const moved = still.el.getBoundingClientRect().top - still.top;
  if (Math.abs(moved) >= 0.5) scroller.scrollTop += moved;
}
