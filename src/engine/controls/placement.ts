import { scaledPx } from "../tokens/chrome-scale";

/** How close a popup comes to the window's edge, in interface pixels. */
export const EDGE = 8;

/** `left` moved so a box `width` wide stays inside the window, or short of
 *  `right` when something it shouldn't cover lies there. */
export function clampLeft(
  left: number,
  width: number,
  margin = scaledPx(EDGE),
  right = window.innerWidth,
): number {
  return Math.max(margin, Math.min(left, right - width - margin));
}

/** `top` moved so a box `height` tall stays inside the window. */
export function clampTop(
  top: number,
  height: number,
  margin = scaledPx(EDGE),
): number {
  return Math.max(margin, Math.min(top, window.innerHeight - height - margin));
}

/** Whether a popup `height` tall opens below `anchor` (`gap` away) rather
 *  than above it: where it fits, or where there is more room. */
export function opensBelow(
  anchor: { top: number; bottom: number },
  height: number,
  gap: number,
  margin = scaledPx(EDGE),
): boolean {
  const below = window.innerHeight - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  return below >= height || below >= above;
}

export type PopupSide = "above" | "below" | "left" | "right";

const ACROSS: Record<PopupSide, PopupSide> = {
  above: "below",
  below: "above",
  left: "right",
  right: "left",
};

/** The side of `anchor` a box `size` takes, `gap` away: `side`, or the one
 *  across from it when only that fits (`side` when neither does). */
export function sideThatFits(
  side: PopupSide,
  anchor: { top: number; bottom: number; left: number; right: number },
  size: { width: number; height: number },
  gap: number,
  margin = scaledPx(EDGE),
): PopupSide {
  const fits: Record<PopupSide, boolean> = {
    above: anchor.top - gap - size.height >= margin,
    below: anchor.bottom + gap + size.height <= window.innerHeight - margin,
    left: anchor.left - gap - size.width >= margin,
    right: anchor.right + gap + size.width <= window.innerWidth - margin,
  };
  return fits[side] || !fits[ACROSS[side]] ? side : ACROSS[side];
}
