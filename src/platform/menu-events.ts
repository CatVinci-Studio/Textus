import { emitToWindow } from "./events";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { thisWindow } from "./this-window";
import type { NativeMenuId } from "../registry/menu/app-menu-model";
import { menuIpc } from "./ipc";

/**
 * iOS has no native menu, so this turns a phone menu id into the window
 * event the menu bridge listens for and sends it to this webview.
 */
export function emitMenuEvent(id: NativeMenuId): void {
  const [event, payload] = id.startsWith("help-doc:")
    ? ["menu-open-help", id.slice("help-doc:".length)]
    : id.startsWith("insert-block:")
      ? ["menu-insert-block", id.slice("insert-block:".length)]
      : id.startsWith("toggle-mark:")
        ? ["menu-toggle-mark", id.slice("toggle-mark:".length)]
        : id.startsWith("plugin-command:")
          ? ["menu-plugin-command", id.slice("plugin-command:".length)]
          : [`menu-${id}`, undefined];
  emitToThisWindow(event, payload);
}

/** A menu event sent to this window only, as its own menu item would. */
export function emitToThisWindow(event: string, payload?: unknown): void {
  // Addressed to the WebviewWindow: a bare label is AnyLabel, which on iOS
  // delivered the event twice, so every toggle undid itself.
  const { label } = getCurrentWebviewWindow();
  void emitToWindow({ kind: "WebviewWindow", label }, event, payload);
}

/**
 * A menu item run from inside this window, as a native menu click would be.
 * Close Window closes this window itself, since a window focused in its
 * webview may report no focus; close() still asks about unsaved tabs.
 */
export function runMenuItemHere(id: string): Promise<void> {
  if (id === "close-window") return thisWindow().close();
  return menuIpc.triggerMenuItem(id);
}
