/** The interface's size step now, as `--chrome-scale` has it: Interface
 *  Size, Medium 1 - not the window's size (as VS Code,
 *  Obsidian and Typora: a bigger window shows more, not bigger). A panel's
 *  widths are in this step's units, so it grows with what it holds. */
let phone: { step: string; scale: number } | null = null;

export function chromeScale(): number {
  if (typeof document === "undefined") return 1;
  const root = document.documentElement;
  // The phone's steps are numbers of their own (ui-sizes-phone.css), read
  // once a step: reading forces a style pass, and resizing asks often.
  if (root.dataset.windowChrome === "mobile") {
    const step = root.dataset.uiSize ?? "medium";
    if (phone?.step === step) return phone.scale;
    const scale = Number.parseFloat(
      getComputedStyle(root).getPropertyValue("--chrome-scale"),
    );
    // Not kept before the stylesheet has it.
    if (!(scale > 0)) return 1;
    phone = { step, scale };
    return scale;
  }
  return Number.parseFloat(root.style.getPropertyValue("--ui-text-scale")) || 1;
}

/** `n` interface pixels as drawn now: a size set from script grows with
 *  the interface as the stylesheets' lengths do. */
export function scaledPx(n: number): number {
  return typeof window === "undefined" ? n : n * chromeScale();
}
