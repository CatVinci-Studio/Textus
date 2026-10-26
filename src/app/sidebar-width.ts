import { useCallback, useState } from "react";
import { getUiState, setUiState } from "../storage/ui-state";

/** The sidebar's width as it comes, and the narrowest it can be dragged to:
 *  under this the tree's names are cut to a few letters. */
export const SIDEBAR_DEFAULT_WIDTH = 240;
export const SIDEBAR_MIN_WIDTH = 180;
/** The widest it can be dragged to, and the share of a small window it may
 *  take. */
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_MAX_SHARE = 0.45;

/** The widest the sidebar may be in a window this wide. */
export function sidebarMaxWidth(windowWidth: number): number {
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, Math.floor(windowWidth * SIDEBAR_MAX_SHARE)),
  );
}

export function clampSidebarWidth(width: number, windowWidth: number): number {
  return Math.round(
    Math.min(sidebarMaxWidth(windowWidth), Math.max(SIDEBAR_MIN_WIDTH, width)),
  );
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
