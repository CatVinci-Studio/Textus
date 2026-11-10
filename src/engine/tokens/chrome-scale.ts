/** What 100% Interface Text Size draws at on the desktop: one step up from
 *  the first design, every step growing with it (design-system.css
 *  --chrome-base). */
export const CHROME_BASE = 1.1;

/** The interface's size step now, as `--chrome-scale` has it: Interface
 *  Text Size on the desktop's base - not the window's size (as VS Code,
 *  Obsidian and Typora: a bigger window shows more, not bigger). A panel's
 *  widths are in this step's units, so it grows with what it holds. */
export function chromeScale(): number {
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
  return CHROME_BASE * text;
}

/** `n` interface pixels as drawn now: a size set from script grows with
 *  the interface as the stylesheets' lengths do. */
export function scaledPx(n: number): number {
  return typeof window === "undefined" ? n : n * chromeScale();
}
