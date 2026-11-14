/** Where the tour's lit hole and its card go: plain geometry, no page. */

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

/** The hole round `target`, padded and kept inside the window. */
export function holeAround(target: Box, view: Size): Box {
  const left = Math.max(0, target.left - PAD);
  const top = Math.max(0, target.top - PAD);
  const right = Math.min(view.width, target.left + target.width + PAD);
  const bottom = Math.min(view.height, target.top + target.height + PAD);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, Math.max(low, high)));

/**
 * The card's corner: in the middle with no hole; on a phone below the hole,
 * or above it when the hole is low; elsewhere to its right, left, below or
 * above, the first with room, centred on it along that side. With none,
 * the window's lower right corner.
 */
export function placeCard(
  hole: Box | null,
  card: Size,
  view: Size,
  phone: boolean,
): { left: number; top: number } {
  const maxLeft = view.width - card.width - GAP;
  const maxTop = view.height - card.height - GAP;
  if (!hole)
    return {
      left: clamp((view.width - card.width) / 2, GAP, maxLeft),
      top: clamp((view.height - card.height) / 2, GAP, maxTop),
    };
  const middleX = hole.left + hole.width / 2 - card.width / 2;
  const middleY = hole.top + hole.height / 2 - card.height / 2;
  const below = hole.top + hole.height + GAP;
  const above = hole.top - GAP - card.height;
  if (phone) {
    const low = hole.top + hole.height / 2 > view.height / 2;
    const top = low || below > maxTop ? above : below;
    return {
      left: clamp((view.width - card.width) / 2, GAP, maxLeft),
      top: clamp(top, GAP, maxTop),
    };
  }
  const right = hole.left + hole.width + GAP;
  const left = hole.left - GAP - card.width;
  const sides = [
    { fits: right <= maxLeft, left: right, top: middleY },
    { fits: left >= GAP, left, top: middleY },
    { fits: below <= maxTop, left: middleX, top: below },
    { fits: above >= GAP, left: middleX, top: above },
  ];
  const side = sides.find((s) => s.fits);
  if (!side)
    return { left: Math.max(GAP, maxLeft), top: Math.max(GAP, maxTop) };
  return {
    left: clamp(side.left, GAP, maxLeft),
    top: clamp(side.top, GAP, maxTop),
  };
}
