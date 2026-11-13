import { isMobileApp } from "./capabilities";

/**
 * Stops iOS WebKit zooming into a sub-16px field on focus and staying
 * zoomed. maximum-scale does only that on iOS; pinch-to-zoom stays. The
 * page still covers the screen edge to edge, with the safe area's insets.
 */
export function installMobileViewport(): void {
  if (!isMobileApp) return;
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover",
    );
  nativeSafeTop();
  window.addEventListener("resize", nativeSafeTop);
}

/** Android's web view, ending above the navigation bar, reports no safe
 *  area at its top: the app says how tall the status bar is. */
function nativeSafeTop(): void {
  const insets = (window as { TextusInsets?: { top(): number } }).TextusInsets;
  if (!insets) return;
  document.documentElement.style.setProperty(
    "--native-safe-top",
    `${insets.top()}px`,
  );
}
