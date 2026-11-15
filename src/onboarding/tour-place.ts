/** Where the tour's lit hole and its card go: plain geometry, no page. */

import { scaledPx } from "../engine/tokens/chrome-scale";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

/** Room kept between the card and the hole, and from the window's edge. */
const GAP = 16;
/** Around the lit part, so its edge isn't cut by the hole. */
const PAD = 6;
/** The narrowest the card gets to stay beside the hole, not over it. */
const NARROWEST = 240;

/** The hole round `target`, padded and kept inside the window. */
export function holeAround(target: Box, view: Size): Box {
  const pad = scaledPx(PAD);
  const left = Math.max(0, target.left - pad);
  const top = Math.max(0, target.top - pad);
  const right = Math.min(view.width, target.left + target.width + pad);
  const bottom = Math.min(view.height, target.top + target.height + pad);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, Math.max(low, high)));

/** Whether a card at `at` would cover any of `box`. */
function covers(at: { left: number; top: number }, card: Size, box: Box) {
  return (
    at.left < box.left + box.width &&
    at.left + card.width > box.left &&
    at.top < box.top + box.height &&
    at.top + card.height > box.top
  );
}

/**
 * The card's corner: in the middle with no hole; on a phone below the hole,
 * or above it when the hole is low; elsewhere to its right, left, below or
 * above, the first with room, centred on it along that side, and never
 * over `lit` (the whole hole, where `hole` is the part it is level with).
 * With none, narrower beside it when there is room for that (`width`),
 * else the window's corner clear of it, else its lower right.
 */
export function placeCard(
  hole: Box | null,
  card: Size,
  view: Size,
  phone: boolean,
  lit: Box | null = hole,
): { left: number; top: number; width?: number } {
  const gap = scaledPx(GAP);
  const maxLeft = view.width - card.width - gap;
  const maxTop = view.height - card.height - gap;
  if (!hole)
    return {
      left: clamp((view.width - card.width) / 2, gap, maxLeft),
      top: clamp((view.height - card.height) / 2, gap, maxTop),
    };
  const middleX = hole.left + hole.width / 2 - card.width / 2;
  const middleY = hole.top + hole.height / 2 - card.height / 2;
  const below = hole.top + hole.height + gap;
  const above = hole.top - gap - card.height;
  if (phone) {
    const low = hole.top + hole.height / 2 > view.height / 2;
    const top = low || below > maxTop ? above : below;
    return {
      left: clamp((view.width - card.width) / 2, gap, maxLeft),
      top: clamp(top, gap, maxTop),
    };
  }
  const right = hole.left + hole.width + gap;
  const left = hole.left - gap - card.width;
  const at = (x: number, y: number) => ({
    left: clamp(x, gap, maxLeft),
    top: clamp(y, gap, maxTop),
  });
  const sides = [
    { fits: right <= maxLeft, ...at(right, middleY) },
    { fits: left >= gap, ...at(left, middleY) },
    { fits: below <= maxTop, ...at(middleX, below) },
    { fits: above >= gap, ...at(middleX, above) },
  ];
  const clear = (place: { left: number; top: number }) =>
    !lit || !covers(place, card, lit);
  const side = sides.find((s) => s.fits && clear(s));
  if (side) return { left: side.left, top: side.top };
  if (lit) {
    const roomRight = view.width - (lit.left + lit.width) - 2 * gap;
    const roomLeft = lit.left - 2 * gap;
    const room = Math.max(roomRight, roomLeft);
    if (room >= scaledPx(NARROWEST) && room < card.width)
      return {
        left: roomRight >= roomLeft ? lit.left + lit.width + gap : gap,
        top: clamp(middleY, gap, maxTop),
        width: room,
      };
  }
  const corners = [
    at(maxLeft, maxTop),
    at(gap, maxTop),
    at(maxLeft, gap),
    at(gap, gap),
  ];
  return corners.find(clear) ?? corners[0]!;
}
