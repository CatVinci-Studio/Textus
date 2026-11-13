/** The phone keeps its first design, a step under the desktop's
 *  (ds-base.css). */
const PHONE_SCALE = 10 / 11;

/** The interface's size step now, as `--chrome-scale` has it: Interface
 *  Size, Medium 1 - not the window's size (as VS Code,
 *  Obsidian and Typora: a bigger window shows more, not bigger). A panel's
 *  widths are in this step's units, so it grows with what it holds. */
export function chromeScale(): number {
  // The phone's chrome keeps its size (design-system.css).
  if (
    typeof document !== "undefined" &&
    document.documentElement.dataset.windowChrome === "mobile"
  )
    return PHONE_SCALE;
  const text =
    typeof document === "undefined"
      ? 1
      : Number.parseFloat(
          document.documentElement.style.getPropertyValue("--ui-text-scale"),
        ) || 1;
  return text;
}

/** `n` interface pixels as drawn now: a size set from script grows with
 *  the interface as the stylesheets' lengths do. */
export function scaledPx(n: number): number {
  return typeof window === "undefined" ? n : n * chromeScale();
}
