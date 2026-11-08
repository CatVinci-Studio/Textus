/**
 * The one rule both side panels follow - the sidebar on the left and the AI
 * panel on the right: each keeps the width it was dragged to, but a window
 * too small for it shows it narrower, at most a share of the window and
 * always leaving the document room between them.
 */

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
): number {
  return Math.max(
    limits.min,
    Math.min(
      limits.max,
      Math.floor(windowWidth * PANEL_SHARE),
      windowWidth - beside - DOCUMENT_MIN_WIDTH,
    ),
  );
}

export function clampSidePanel(
  width: number,
  windowWidth: number,
  limits: PanelLimits,
  beside = 0,
): number {
  return Math.round(
    Math.min(
      sidePanelMax(windowWidth, limits, beside),
      Math.max(limits.min, width),
    ),
  );
}
