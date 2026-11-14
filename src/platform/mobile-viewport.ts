import { isIOSApp, isMobileApp } from "./capabilities";

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
  if (isIOSApp) watchWebKitInsets();
  safeArea();
  window.addEventListener("resize", safeArea);
}

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What the page keeps clear of at each edge (--native-safe-*, which the
 *  stylesheets read as --safe-top and the rest). */
function safeArea(): void {
  const insets = isIOSApp ? turned(webKitInsets()) : androidInsets();
  if (!insets) return;
  const style = document.documentElement.style;
  for (const side of ["top", "right", "bottom", "left"] as const)
    style.setProperty(`--native-safe-${side}`, `${insets[side]}px`);
}

/** Android's web view, ending only at the keyboard, reports no safe area:
 *  the app says how tall the status bar and the navigation bar are, and
 *  what the cutout or a side navigation bar takes at either side. */
function androidInsets(): Insets | null {
  const native = (
    window as { TextusInsets?: Record<keyof Insets, () => number> }
  ).TextusInsets;
  return native
    ? {
        top: native.top(),
        right: native.right(),
        bottom: native.bottom(),
        left: native.left(),
      }
    : null;
}

/** A hidden box as big as WebKit's safe area: WebKit fills the insets in
 *  after the page has loaded, and anew a moment after a turn, telling
 *  nothing; the box's size changing says so. */
let probe: HTMLElement | null = null;

function watchWebKitInsets(): void {
  probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  new ResizeObserver(safeArea).observe(probe);
}

function webKitInsets(): Insets {
  const style = probe ? getComputedStyle(probe) : null;
  const px = (value: string | undefined) => parseFloat(value ?? "") || 0;
  return {
    top: px(style?.paddingTop),
    right: px(style?.paddingRight),
    bottom: px(style?.paddingBottom),
    left: px(style?.paddingLeft),
  };
}

/**
 * An iPhone turned on its side can go on reporting its upright insets: the
 * camera's at the top, none at the sides. Its camera is then at one side
 * and a corner as round at the other, each as deep as the top was, and no
 * status bar. An iPad's are left as they are: its status bar stays on top.
 */
export function turned(
  insets: Insets,
  width = innerWidth,
  height = innerHeight,
): Insets {
  const phoneOnSide = width > height && height < 500;
  if (!phoneOnSide || insets.left || insets.right || !insets.top) return insets;
  return { ...insets, top: 0, left: insets.top, right: insets.top };
}
