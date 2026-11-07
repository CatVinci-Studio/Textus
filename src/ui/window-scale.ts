/**
 * The chrome's size step for the window's width: 1 up to 1200px, then a
 * straight line up to 1.35 (reached at 2320px), so icons and the title bar
 * grow with a large or full-screen window. Read by `--chrome-scale`.
 */
export function windowScale(width: number): number {
  return Math.min(1.35, Math.max(1, 1 + (width - 1200) / 3200));
}

/** Keeps `--window-scale` on <html> in step with the window's width. */
export function installWindowScale(): void {
  const root = document.documentElement;
  const apply = () =>
    root.style.setProperty(
      "--window-scale",
      windowScale(window.innerWidth).toFixed(3),
    );
  apply();
  window.addEventListener("resize", apply);
}
