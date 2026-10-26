import { getCurrentWindow } from "@tauri-apps/api/window";
import { selectAllInFocus } from "../../ui/select-all";
import { EDIT_ACTION_EVENT } from "../../utils/events";
import type { LocalMenuAction, MenuAction } from "./app-menu-model";
import { canToggleFullscreen, hasAppMenu } from "../../platform/capabilities";
import { emitMenuEvent, runMenuItemHere } from "../../platform/menu-events";

/**
 * The app-drawn menu's items that never had a native id to send.
 *
 * They were `PredefinedMenuItem`s in the native menu (Undo, Cut, Copy,
 * Paste, Select All, Toggle Full Screen) - muda generates their ids and
 * offers no way to fire one from outside a click, so `trigger_menu_item`
 * cannot reach them. Every one of them is already implemented on this side
 * anyway: the editing five are what the right-click menu runs (see
 * editor/useEditorClipboard.ts and the EDIT_ACTION_EVENT listener in
 * MilkdownEditor.tsx), and fullscreen is a window API call.
 */
/** Runs a menu entry's action as a click on it would: a native id through
 *  the backend's dispatch (or, with no native menu, as its window event),
 *  a local one here. */
export function runMenuAction(action: MenuAction): void {
  if ("local" in action) runLocalMenuAction(action.local);
  else if (!hasAppMenu) emitMenuEvent(action.native);
  else
    void runMenuItemHere(action.native).catch(() => {
      // A failed menu command is the backend's to report; swallowing it
      // here only leaves a dead menu on screen.
    });
}

export function runLocalMenuAction(action: LocalMenuAction): void {
  if (action === "select-all") {
    selectAllInFocus();
    return;
  }
  if (action === "fullscreen") {
    if (!canToggleFullscreen) return;
    void (async () => {
      const win = getCurrentWindow();
      await win.setFullscreen(!(await win.isFullscreen()));
    })();
    return;
  }
  window.dispatchEvent(new CustomEvent(EDIT_ACTION_EVENT, { detail: action }));
}
