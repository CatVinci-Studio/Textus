/** The phone's --chrome-scale at each Interface Size step, as ui-sizes.css
 *  sets it: a step under the desktop's at Medium. */
export const PHONE_SCALES: Record<string, number> = {
  small: 0.84,
  medium: 0.91,
  large: 1,
  xlarge: 1.14,
  xxlarge: 1.27,
};

/** The interface's size step now, as `--chrome-scale` has it: Interface
 *  Size, Medium 1 - not the window's size (as VS Code,
 *  Obsidian and Typora: a bigger window shows more, not bigger). A panel's
 *  widths are in this step's units, so it grows with what it holds. */
export function chromeScale(): number {
  if (typeof document === "undefined") return 1;
  const root = document.documentElement;
  if (root.dataset.windowChrome === "mobile")
    return PHONE_SCALES[root.dataset.uiSize ?? "medium"] ?? PHONE_SCALES.medium;
  return Number.parseFloat(root.style.getPropertyValue("--ui-text-scale")) || 1;
}

/** `n` interface pixels as drawn now: a size set from script grows with
 *  the interface as the stylesheets' lengths do. */
export function scaledPx(n: number): number {
  return typeof window === "undefined" ? n : n * chromeScale();
}
