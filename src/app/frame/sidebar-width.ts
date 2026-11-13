import { useIslandsNeed } from "../../engine/frame/frame-store";
import { chromeScale } from "../../engine/tokens/chrome-scale";
import { placeSidebar } from "./useSidebarFrame";
import { useCallback, useState } from "react";
import { getUiState, setUiState } from "../../storage/ui-state";
import {
  clampSidePanel,
  sidePanelMax,
  sidePanelMin,
} from "../../engine/controls/side-panel-width";

/** The sidebar's width as it comes, and the narrowest it can be dragged to:
 *  under this the tree's names are cut to a few letters. */
export const SIDEBAR_DEFAULT_WIDTH = 264;
export const SIDEBAR_MIN_WIDTH = 198;
/** Its narrowest, and the widest it can be dragged to in a window with
 *  room (side-panel-width keeps the document's room). */
export const SIDEBAR_LIMITS = { min: SIDEBAR_MIN_WIDTH, max: 528 };

/** The width last chosen, or the default for anything invalid there. */
export function storedSidebarWidth(): number {
  const stored = getUiState("sidebarPx");
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
  // The islands beside it keep what they need at the least.
  const keep = useIslandsNeed();
  const width = clampSidePanel(
    chosen * scale,
    windowWidth,
    SIDEBAR_LIMITS,
    beside,
    scale,
    keep,
  );
  const setWidth = useCallback(
    (next: number, persist = true) => {
      const step = chromeScale();
      const base = Math.round(
        clampSidePanel(next, windowWidth, SIDEBAR_LIMITS, beside, step, keep) /
          step,
      );
      // While the edge is held, only the shell's column and the sidebar
      // follow, written as their own (not inherited) widths: a variable
      // changed on the shell restyles everything in the window, the
      // document too, every frame. The variable takes over at the end.
      holdWidth(persist ? null : base * step);
      if (!persist) return;
      setChosen(base);
      setUiState("sidebarPx", base);
    },
    [windowWidth, beside, keep],
  );
  const resetWidth = useCallback(() => {
    setChosen(SIDEBAR_DEFAULT_WIDTH);
    setUiState("sidebarPx", SIDEBAR_DEFAULT_WIDTH);
  }, []);
  return {
    width,
    min: Math.round(
      sidePanelMin(windowWidth, SIDEBAR_LIMITS, beside, scale, keep),
    ),
    max: sidePanelMax(windowWidth, SIDEBAR_LIMITS, beside, scale, keep),
    setWidth,
    resetWidth,
  };
}

/** The column and the sidebar drawn at `width` px while a drag lasts;
 *  null hands them back to --sidebar-width once React has drawn it. */
function holdWidth(width: number | null): void {
  const shell = document.querySelector<HTMLElement>(".app-shell");
  const sidebar = shell?.querySelector<HTMLElement>(":scope > .sidebar");
  if (!shell) return;
  if (width === null) {
    requestAnimationFrame(() => {
      shell.style.removeProperty("grid-template-columns");
      sidebar?.style.removeProperty("width");
    });
    return;
  }
  shell.style.setProperty(
    "grid-template-columns",
    `var(--rail-width, 0px) ${width}px minmax(0, 1fr)`,
  );
  sidebar?.style.setProperty("width", `${width}px`);
  if (sidebar) placeSidebar(sidebar, width);
}
