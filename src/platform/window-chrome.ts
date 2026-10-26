import {
  isIOSPlatform,
  isLinuxPlatform,
  isMacPlatform,
  isWindowsPlatform,
} from "./os";
import { canUseWindows, hasAppMenu } from "./capabilities";
/**
 * How much of the window frame this app draws itself. macOS keeps its native
 * frame under an overlay title bar; Windows and Linux drop it, so the caption
 * buttons and menu entry are ours. Must agree with the Rust window builder.
 */

/**
 * Whether the OS frame is gone and the app owns the caption. Read once: it
 * cannot change for a window.
 */
export const appDrawsWindowFrame =
  hasAppMenu && (isWindowsPlatform() || isLinuxPlatform());

/**
 * Whether the frontend must handle the native menu's accelerators. Linux
 * only: GTK fires them only while the menu bar is drawable, and Windows still
 * fires them with it hidden, so handling them there would run each twice.
 */
export const ownsMenuAccelerators = isLinuxPlatform();

/**
 * Whether the app draws the window outline and resize edges. Linux only: an
 * undecorated GTK window loses both, Windows keeps them.
 */
export const drawsWindowEdges = isLinuxPlatform();

/**
 * Which platform's webview this is, for `data-platform`. iOS is checked
 * first: an iPad reports "MacIntel" like a Mac.
 */
export function platformName(): "macos" | "ios" | "windows" | "linux" {
  if (isIOSPlatform()) return "ios";
  if (isMacPlatform()) return "macos";
  if (isWindowsPlatform()) return "windows";
  return "linux";
}

/**
 * Publishes `data-window-chrome` ("mobile" on iOS) and `data-platform` on
 * <html>, before the first render so the title row never paints at the wrong
 * inset. Linux keeps translucent materials off: WebKitGTK blurs on the main thread.
 */
export function publishWindowChrome(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.windowChrome = !canUseWindows
    ? "mobile"
    : appDrawsWindowFrame
      ? "app"
      : "native";
  document.documentElement.dataset.platform = platformName();
}
