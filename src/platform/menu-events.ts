import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { NativeMenuId } from "../app/menu/app-menu-model";
import { menuIpc } from "./ipc";

/**
 * iOS has no menu.rs, so this does its `dispatch` for the ids the phone
 * menu offers: turn the id into the window event useMenuBridge (and
 * useZoom) already listen for, and send it to this webview.
 */
export function emitMenuEvent(id: NativeMenuId): void {
  const [event, payload] = id.startsWith("help-doc:")
    ? ["menu-open-help", id.slice("help-doc:".length)]
    : id.startsWith("insert-block:")
      ? ["menu-insert-block", id.slice("insert-block:".length)]
      : [id === "settings" ? "menu-open-settings" : `menu-${id}`, undefined];
  // Addressed to the WebviewWindow, the form menu.rs's emit_to uses. A bare
  // label is AnyLabel, which on iOS - where the window and its webview are
  // both "main" - delivered the event twice, so every toggle undid itself.
  const { label } = getCurrentWebviewWindow();
  void emitTo({ kind: "WebviewWindow", label }, event, payload);
}

/**
 * A menu item run from inside this window - the app-drawn menu, or a
 * shortcut the page hears first - through the backend's dispatch, as a
 * click in the native menu would be. Close Window closes this window
 * itself: the backend has to ask which window has the focus, and on
 * Windows and Linux a window whose focus is inside its webview may say it
 * has none, so File › Close Window did nothing (#345). close(), as the
 * window's own close button, so unsaved tabs are still asked about.
 */
export function runMenuItemHere(id: string): Promise<void> {
  if (id === "close-window") return getCurrentWindow().close();
  return menuIpc.triggerMenuItem(id);
}
