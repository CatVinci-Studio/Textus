import { useLayoutEffect, useSyncExternalStore } from "react";
import {
  appDrawsWindowFrame,
  platformName,
} from "../../platform/window-chrome";
import { barLayout, type BarLayout } from "./bar-layout";
import { useFullscreenMark } from "./useFullscreenMark";

// Whether the sidebar's column reaches the window's top, for the sidebar:
// where it doesn't, the bar covers its header's line.
let sideToTopNow = false;
const listeners = new Set<() => void>();
function publishSideToTop(next: boolean) {
  if (next === sideToTopNow) return;
  sideToTopNow = next;
  for (const l of listeners) l();
}
export function useSideToTop(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sideToTopNow,
  );
}

/**
 * This window's bar (barLayout), published on <html> for the styles:
 * data-bar-rows; data-menu-in-rail while the app menu sits in the rail's
 * column; data-side-to-top and data-rail-to-top while those columns reach
 * the window's top.
 */
export function useBarLayout({
  menuBarShown,
  rail,
  railOff,
  zen,
}: {
  menuBarShown: boolean;
  rail: boolean;
  railOff: boolean;
  zen: boolean;
}): BarLayout {
  const fullscreen = useFullscreenMark();
  const layout = barLayout({
    platform: platformName(),
    menuBar: appDrawsWindowFrame && menuBarShown,
    rail,
    railOff,
    zen,
    fullscreen,
  });
  const { rows, menuInRail, sideToTop, railToTop } = layout;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.barRows = String(rows);
    root.toggleAttribute("data-menu-in-rail", menuInRail);
    root.toggleAttribute("data-side-to-top", sideToTop);
    root.toggleAttribute("data-rail-to-top", railToTop);
    publishSideToTop(sideToTop);
    return () => {
      delete root.dataset.barRows;
      for (const name of [
        "data-menu-in-rail",
        "data-side-to-top",
        "data-rail-to-top",
      ])
        root.removeAttribute(name);
    };
  }, [rows, menuInRail, sideToTop, railToTop]);
  return layout;
}
