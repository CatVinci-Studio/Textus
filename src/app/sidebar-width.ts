import { useCallback, useState } from "react";
import { getUiState, setUiState } from "../storage/ui-state";
import { clampSidePanel, sidePanelMax } from "../ui/side-panel-width";

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
export function useSidebarWidth(windowWidth: number) {
  const [chosen, setChosen] = useState(storedSidebarWidth);
  const width = clampSidebarWidth(chosen, windowWidth);
  const setWidth = useCallback(
    (next: number, persist = true) => {
      const clamped = clampSidebarWidth(next, windowWidth);
      setChosen(clamped);
      if (persist) setUiState("sidebarWidth", clamped);
    },
    [windowWidth],
  );
  const resetWidth = useCallback(
    () => setWidth(SIDEBAR_DEFAULT_WIDTH),
    [setWidth],
  );
  return {
    width,
    min: SIDEBAR_MIN_WIDTH,
    max: sidebarMaxWidth(windowWidth),
    setWidth,
    resetWidth,
  };
}
