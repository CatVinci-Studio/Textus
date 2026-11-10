import { scaledPx } from "../engine/tokens/chrome-scale";

/** How close a popup comes to the window's edge, in interface pixels. */
export const EDGE = 8;

/** `left` moved so a box `width` wide stays inside the window. */
export function clampLeft(
  left: number,
  width: number,
  margin = scaledPx(EDGE),
): number {
  return Math.max(margin, Math.min(left, window.innerWidth - width - margin));
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
