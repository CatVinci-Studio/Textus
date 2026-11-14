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

/** Android's web view, ending only at the keyboard, reports no safe area:
 *  the app says how tall the status bar and the navigation bar are. */
function nativeSafeTop(): void {
  const insets = (
    window as { TextusInsets?: { top(): number; bottom(): number } }
  ).TextusInsets;
  if (!insets) return;
  const style = document.documentElement.style;
  style.setProperty("--native-safe-top", `${insets.top()}px`);
  style.setProperty("--native-safe-bottom", `${insets.bottom()}px`);
}
