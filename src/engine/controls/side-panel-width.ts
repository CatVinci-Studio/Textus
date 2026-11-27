import { useCallback } from "react";
import { DOC_MIN } from "../frame/island-rules";
import { useIslandsNeed } from "../frame/frame-store";
import { chromeScale } from "../tokens/chrome-scale";
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
  const share = Math.floor(windowWidth * PANEL_SHARE);
  // A large interface size grows the floor too, never past the share: at
  // an iPad's Largest it took more than half the screen.
  return Math.max(
    Math.min(floor(limits) * scale, Math.max(floor(limits), share)),
    Math.min(
      limits.max * scale,
      share,
      windowWidth - beside - Math.max(keep, DOC_MIN),
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

/** A side panel's width now: `chosen` (in the interface's size units) as
 *  shown at its size, the bounds its handle drags within, and a dragged
 *  width in px turned back into the units to keep. The islands beside it
 *  keep what they need at the least. */
export function useSidePanelWidth(
  chosen: number,
  windowWidth: number,
  limits: PanelLimits,
  beside: number,
) {
  const keep = useIslandsNeed();
  const scale = chromeScale();
  const toBase = useCallback(
    (next: number) => {
      const step = chromeScale();
      return Math.round(
        clampSidePanel(next, windowWidth, limits, beside, step, keep) / step,
      );
    },
    [windowWidth, limits, beside, keep],
  );
  return {
    width: clampSidePanel(
      chosen * scale,
      windowWidth,
      limits,
      beside,
      scale,
      keep,
    ),
    min: Math.round(sidePanelMin(windowWidth, limits, beside, scale, keep)),
    max: Math.round(sidePanelMax(windowWidth, limits, beside, scale, keep)),
    toBase,
  };
}
