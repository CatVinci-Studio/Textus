import {
  isAndroidPlatform,
  isIOSPlatform,
  isLinuxPlatform,
  isMacPlatform,
  isWindowsPlatform,
} from "./os";
import { hasAppMenu, isMobileApp } from "./capabilities";
import { isPhoneLayout, onPhoneLayout } from "./phone-layout";
import { readBoot } from "../storage/boot";
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
 * Whether the app draws inner resize edges. Linux only: GTK's frame resizes
 * only from outside the window, Windows from its own edge.
 */
export const drawsWindowEdges = isLinuxPlatform();

/**
 * Whether the page draws the window's outline: Windows 10, whose undecorated
 * window is built without its shadow (editor_windows.rs), the shadow's
 * accent-coloured border with it. Rust says which Windows in the boot
 * snapshot, so the first frame already has it.
 */
export function drawsWindowOutline(): boolean {
  return (
    appDrawsWindowFrame && isWindowsPlatform() && readBoot()?.windows10 === true
  );
}

/**
 * Which platform's webview this is, for `data-platform`. iOS is checked
 * first: an iPad reports "MacIntel" like a Mac.
 */
export function platformName():
  "macos" | "ios" | "android" | "windows" | "linux" {
  if (isIOSPlatform()) return "ios";
  if (isAndroidPlatform()) return "android";
  if (isMacPlatform()) return "macos";
  if (isWindowsPlatform()) return "windows";
  return "linux";
}

/**
 * Publishes `data-window-chrome`, `data-platform` and `data-touch` (iOS and
 * Android: a finger's sizes) on <html>, before the
 * first render so the title row never paints at the wrong inset: "mobile"
 * for the phone's layout, "app" for a tablet's (the desktop's, its menu and
 * frame drawn by the app), else the desktop's own. A tablet that turns to the
 * phone's width (split screen) changes with it.
 */
export function publishWindowChrome(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const publish = () => {
    root.dataset.windowChrome = isMobileApp
      ? isPhoneLayout()
        ? "mobile"
        : "app"
      : appDrawsWindowFrame
        ? "app"
        : "native";
  };
  publish();
  if (isMobileApp) onPhoneLayout(publish);
  root.dataset.platform = platformName();
  // A finger's sizes (44pt targets, a taller bar) hang on this one mark.
  root.toggleAttribute("data-touch", isMobileApp);
}
