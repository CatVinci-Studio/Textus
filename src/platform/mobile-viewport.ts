import { androidBridge } from "./android-bridge";
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
  // The app says when its bars change: a half turn or a fold may not
  // resize the page, or resize it before the bars are known. iOS's says
  // what they are (SystemBars.swift).
  window.addEventListener("textus-insets", safeArea);
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
  applyInsets(isIOSApp ? (iosInsets() ?? webKitInsets()) : androidInsets());
}

/** What iOS's app last said (SystemBars.swift): only it knows which way the
 *  phone is turned, so which side the camera is at. WebKit's own are read
 *  until it says. */
const iosInsets = () =>
  (window as { textusInsets?: Insets }).textusInsets ?? null;

const SIDES = ["top", "right", "bottom", "left"] as const;

/** Sets the insets; none known yet (all 0 on iOS before WebKit has them)
 *  leaves the stylesheets on env(), which WebKit fills in itself. */
export function applyInsets(
  insets: Insets | null,
  style = document.documentElement.style,
  ios = isIOSApp,
): void {
  if (!insets) return;
  const known = ios ? SIDES.some((side) => insets[side] > 0) : true;
  for (const side of SIDES)
    if (known) style.setProperty(`--native-safe-${side}`, `${insets[side]}px`);
    else style.removeProperty(`--native-safe-${side}`);
}

/** Android's web view, ending only at the keyboard, reports no safe area:
 *  the app says how tall the status bar and the navigation bar are, and
 *  what the cutout or a side navigation bar takes at either side. */
function androidInsets(): Insets | null {
  const android = androidBridge();
  return android
    ? {
        top: android.top(),
        right: android.right(),
        bottom: android.bottom(),
        left: android.left(),
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
  // Its border box: the padding is all it has, its content box stays 0.
  new ResizeObserver(safeArea).observe(probe, { box: "border-box" });
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
