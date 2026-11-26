/** The interface's size step now, as `--chrome-scale` has it: Interface
 *  Size, Medium 1 - not the window's size (as VS Code,
 *  Obsidian and Typora: a bigger window shows more, not bigger). A panel's
 *  widths are in this step's units, so it grows with what it holds. */
export function chromeScale(): number {
  if (typeof document === "undefined") return 1;
  const root = document.documentElement;
  // The phone's steps are numbers of their own (ui-sizes-phone.css).
  if (root.dataset.windowChrome === "mobile")
    return (
      Number.parseFloat(
        getComputedStyle(root).getPropertyValue("--chrome-scale"),
      ) || 1
    );
  return Number.parseFloat(root.style.getPropertyValue("--ui-text-scale")) || 1;
}

/** `n` interface pixels as drawn now: a size set from script grows with
 *  the interface as the stylesheets' lengths do. */
export function scaledPx(n: number): number {
  return typeof window === "undefined" ? n : n * chromeScale();
}
