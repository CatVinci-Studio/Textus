import { useLayoutEffect } from "react";
import {
  appDrawsWindowFrame,
  platformName,
} from "../../platform/window-chrome";
import { barLayout, type BarLayout } from "./bar-layout";
import { useFullscreenMark } from "./useFullscreenMark";

/**
 * This window's bar (barLayout), published on <html> for the styles:
 * data-bar-rows; data-menu-in-rail while the app menu sits in the rail's
 * column; data-side-to-top and data-rail-to-top while those columns reach
 * the window's top.
 */
export function useBarLayout({
  menuBarShown,
  rail,
  zen,
}: {
  menuBarShown: boolean;
  rail: boolean;
  zen: boolean;
}): BarLayout {
  const fullscreen = useFullscreenMark();
  const layout = barLayout({
    platform: platformName(),
    menuBar: appDrawsWindowFrame && menuBarShown,
    rail,
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
