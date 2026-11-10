/** The most a wide window adds: on top of the desktop's one step up, a
 *  full-screen window on a large display stays near 1.25x its design. */
const MOST = 1.15;

/**
 * The chrome's size step for the window's width: 1 up to 1200px, then a
 * gentle line up to MOST (reached about 2550px), so icons and the title bar
 * keep pace with a large or full-screen window without outgrowing it. Read
 * by `--chrome-scale`.
 */
export function windowScale(width: number): number {
  return Math.min(MOST, Math.max(1, 1 + (width - 1200) / 9000));
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
