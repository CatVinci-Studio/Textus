import { scaledPx } from "../../engine/tokens/chrome-scale";

/** A box in the editor's own layout units (inside the document's zoom). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The space between the handle and the block's text (or its marker). */
const GAP = 4;

/**
 * Where the handle stands for a block: in the margin left of its text -
 * and of a list item's marker, `marker` wide - its middle on the block's
 * first line, `line` high.
 */
export function handlePlace(
  block: Box,
  line: number,
  handle: { w: number; h: number },
  marker = 0,
): { x: number; y: number } {
  return {
    x: block.x - marker - scaledPx(GAP) - handle.w,
    y: block.y + Math.max(0, (line - handle.h) / 2),
  };
}

/** `el`'s box in `root`, as laid out: screen boxes inside the document's
 *  zoom differ by engine. Scrolled containers on the way are taken off. */
export function boxIn(root: HTMLElement, el: HTMLElement): Box {
  let x = 0;
  let y = 0;
  for (let n: HTMLElement | null = el; n && n !== root;) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  for (let n = el.parentElement; n && n !== root; n = n.parentElement) {
    x -= n.scrollLeft;
    y -= n.scrollTop;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/** Of the gaps a dragged block can land in (their top in the editor's
 *  units, and the left of the container they are in), the one for a
 *  pointer at `x`, `y`: the nearest by height; at the same height (the end
 *  of a nested list and of the list around it), the innermost the pointer
 *  is right of. */
export function nearestGap<G extends { y: number; left: number }>(
  gaps: readonly G[],
  x: number,
  y: number,
): G | null {
  let best: G | null = null;
  for (const gap of gaps) {
    if (!best) {
      best = gap;
      continue;
    }
    const d = Math.abs(gap.y - y) - Math.abs(best.y - y);
    if (d < -1) best = gap;
    else if (d <= 1 && gap.left <= x && (best.left > x || gap.left > best.left))
      best = gap;
  }
  return best;
}

/** The places as they stand with the room open at `at` (null: none): what
 *  is after it moved down by the block's height `tall`. */
export const withRoom = <G extends { pos: number; y: number }>(
  gaps: readonly G[],
  at: number | null,
  tall: number,
): readonly G[] =>
  at === null
    ? gaps
    : gaps.map((g) => ({
        ...g,
        y: g.y + (g.pos > at ? tall : g.pos === at ? tall / 2 : 0),
      }));
