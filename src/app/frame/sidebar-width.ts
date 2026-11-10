import { chromeScale } from "../../engine/tokens/chrome-scale";
import { useCallback, useState } from "react";
import { getUiState, setUiState } from "../../storage/ui-state";
import {
  clampSidePanel,
  sidePanelMax,
  sidePanelMin,
} from "../../engine/controls/side-panel-width";

/** The sidebar's width as it comes, and the narrowest it can be dragged to:
 *  under this the tree's names are cut to a few letters. */
export const SIDEBAR_DEFAULT_WIDTH = 240;
export const SIDEBAR_MIN_WIDTH = 180;
/** The widest it can be dragged to, in a window with room. */
const LIMITS = { min: SIDEBAR_MIN_WIDTH, max: 480 };

/** The widest the sidebar may be in a window this wide (side-panel-width). */
export function sidebarMaxWidth(windowWidth: number): number {
  return sidePanelMax(windowWidth, LIMITS);
}

export function clampSidebarWidth(width: number, windowWidth: number): number {
  return clampSidePanel(width, windowWidth, LIMITS);
}

/** The width last chosen, or the default for anything invalid there. */
export function storedSidebarWidth(): number {
  const stored = getUiState("sidebarWidth");
  return typeof stored === "number" && Number.isFinite(stored) && stored > 0
    ? Math.round(stored)
    : SIDEBAR_DEFAULT_WIDTH;
}

/**
 * The sidebar's width, remembered across launches and windows. A window too
 * small for it shows it narrower, and a drag remembers only where it let go.
 */
export function useSidebarWidth(windowWidth: number, beside = 0) {
  // Kept in the interface's size units, shown at its size now.
  const [chosen, setChosen] = useState(storedSidebarWidth);
  const scale = chromeScale();
  const width = clampSidePanel(
    chosen * scale,
    windowWidth,
    LIMITS,
    beside,
    scale,
  );
  const setWidth = useCallback(
    (next: number, persist = true) => {
      const step = chromeScale();
      const base = Math.round(
        clampSidePanel(next, windowWidth, LIMITS, beside, step) / step,
      );
      setChosen(base);
      if (persist) setUiState("sidebarWidth", base);
    },
    [windowWidth, beside],
  );
  const resetWidth = useCallback(() => {
    setChosen(SIDEBAR_DEFAULT_WIDTH);
    setUiState("sidebarWidth", SIDEBAR_DEFAULT_WIDTH);
  }, []);
  return {
    width,
    min: Math.round(sidePanelMin(windowWidth, LIMITS, beside, scale)),
    max: sidePanelMax(windowWidth, LIMITS, beside, scale),
    setWidth,
    resetWidth,
  };
}
