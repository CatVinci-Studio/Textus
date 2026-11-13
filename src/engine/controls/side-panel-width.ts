import { docMin } from "../frame/island-rules";
/**
 * The one rule both side panels follow - the sidebar on the left and the AI
 * panel on the right: each keeps the width it was dragged to, but a window
 * too small for it shows it narrower, at most a share of the window and
 * always leaving the document room between them.
 */

/** The most of the window one panel takes. */
const PANEL_SHARE = 0.45;

interface PanelLimits {
  /** The narrowest it is dragged to. */
  min: number;
  /** The widest it is dragged to, in a window with room. */
  max: number;
}

/** The narrowest a panel gets, however small the window (or its own
 *  minimum, if smaller). */
export const PANEL_FLOOR = 220;
const floor = (limits: PanelLimits) => Math.min(limits.min, PANEL_FLOOR);
/** Room a squeezed panel keeps to be dragged in. */
const DRAG_ROOM = 110;

/** The widest a panel may be in a window `windowWidth` wide, beside
 *  `beside` px of the other panel: the islands keep their room first -
 *  `keep`, what they need at the least (frame-store's need), else one
 *  document's. */
export function sidePanelMax(
  windowWidth: number,
  limits: PanelLimits,
  beside = 0,
  scale = 1,
  keep = 0,
): number {
  return Math.max(
    floor(limits) * scale,
    Math.min(
      limits.max * scale,
      Math.floor(windowWidth * PANEL_SHARE),
      windowWidth - beside - Math.max(keep, docMin()),
    ),
  );
}

/** The narrowest it may be dragged to: its own minimum, lower in a small
 *  window so a squeezed panel can still be dragged. */
export function sidePanelMin(
  windowWidth: number,
  limits: PanelLimits,
  beside = 0,
  scale = 1,
  keep = 0,
): number {
  const max = sidePanelMax(windowWidth, limits, beside, scale, keep);
  return Math.min(
    limits.min * scale,
    Math.max(floor(limits) * scale, max - DRAG_ROOM * scale),
  );
}

/** `width` (px on screen) as the panel shows it at `scale`. */
export function clampSidePanel(
  width: number,
  windowWidth: number,
  limits: PanelLimits,
  beside = 0,
  scale = 1,
  keep = 0,
): number {
  return Math.round(
    Math.min(
      sidePanelMax(windowWidth, limits, beside, scale, keep),
      Math.max(sidePanelMin(windowWidth, limits, beside, scale, keep), width),
    ),
  );
}
