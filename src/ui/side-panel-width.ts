/**
 * The one rule both side panels follow - the sidebar on the left and the AI
 * panel on the right: each keeps the width it was dragged to, but a window
 * too small for it shows it narrower, at most a share of the window and
 * always leaving the document room between them.
 */

import { windowScale } from "./window-scale";

/** The interface's size step now, as `--chrome-scale` has it: Interface
 *  Text Size times the window's width step. A panel's widths are in this
 *  step's units, so it grows with what it holds. */
export function chromeScaleAt(windowWidth: number): number {
  const text =
    typeof document === "undefined"
      ? 1
      : Number.parseFloat(
          document.documentElement.style.getPropertyValue("--ui-text-scale"),
        ) || 1;
  return text * windowScale(windowWidth);
}

/** The narrowest the document column is squeezed to by a panel. */
export const DOCUMENT_MIN_WIDTH = 360;
/** The most of the window one panel takes. */
const PANEL_SHARE = 0.45;

export interface PanelLimits {
  /** The narrowest it is dragged to. */
  min: number;
  /** The widest it is dragged to, in a window with room. */
  max: number;
}

/** The widest a panel may be in a window `windowWidth` wide, beside
 *  `beside` px of the other panel. */
export function sidePanelMax(
  windowWidth: number,
  limits: PanelLimits,
  beside = 0,
  scale = 1,
): number {
  return Math.max(
    limits.min * scale,
    Math.min(
      limits.max * scale,
      Math.floor(windowWidth * PANEL_SHARE),
      windowWidth - beside - DOCUMENT_MIN_WIDTH * scale,
    ),
  );
}

/** `width` (px on screen) as the panel shows it at `scale`. */
export function clampSidePanel(
  width: number,
  windowWidth: number,
  limits: PanelLimits,
  beside = 0,
  scale = 1,
): number {
  return Math.round(
    Math.min(
      sidePanelMax(windowWidth, limits, beside, scale),
      Math.max(limits.min * scale, width),
    ),
  );
}
