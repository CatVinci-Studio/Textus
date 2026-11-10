import { useLayoutEffect } from "react";
import {
  appDrawsWindowFrame,
  platformName,
} from "../../platform/window-chrome";
import { barLayout, type BarLayout } from "./bar-layout";
import { useFullscreenMark } from "./useFullscreenMark";

/**
 * This window's bar (barLayout), published on <html> for the styles:
 * data-bar-rows, and data-menu-in-rail while the app menu sits in the
 * rail's column.
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
  const { rows, menuInRail } = layout;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.barRows = String(rows);
    root.toggleAttribute("data-menu-in-rail", menuInRail);
    return () => {
      delete root.dataset.barRows;
      root.removeAttribute("data-menu-in-rail");
    };
  }, [rows, menuInRail]);
  return layout;
}
