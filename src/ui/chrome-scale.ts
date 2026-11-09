import { windowScale } from "./window-scale";

/** The interface's size step now, as `--chrome-scale` has it: Interface
 *  Text Size times the window's width step. A panel's widths are in this
 *  step's units, so it grows with what it holds. */
export function chromeScaleAt(windowWidth: number): number {
  // The phone's chrome keeps its size (design-system.css).
  if (
    typeof document !== "undefined" &&
    document.documentElement.dataset.windowChrome === "mobile"
  )
    return 1;
  const text =
    typeof document === "undefined"
      ? 1
      : Number.parseFloat(
          document.documentElement.style.getPropertyValue("--ui-text-scale"),
        ) || 1;
  return text * windowScale(windowWidth);
}

/** `n` interface pixels as drawn now: a size set from script grows with
 *  the interface as the stylesheets' lengths do. */
export function scaledPx(n: number): number {
  return typeof window === "undefined"
    ? n
    : n * chromeScaleAt(window.innerWidth);
}
