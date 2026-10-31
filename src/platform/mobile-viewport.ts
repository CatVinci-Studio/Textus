import { isIOSApp } from "./capabilities";

/**
 * Stops iOS WebKit zooming into a sub-16px field on focus and staying
 * zoomed. maximum-scale does only that on iOS; pinch-to-zoom stays. The
 * page still covers the screen edge to edge, with the safe area's insets.
 */
export function installMobileViewport(): void {
  if (!isIOSApp) return;
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover",
    );
}
