import { getCurrentWindow } from "@tauri-apps/api/window";
import { selectAllInFocus } from "../ui/select-all";
import { EDIT_ACTION_EVENT } from "../utils/events";
import type { LocalMenuAction } from "./app-menu-model";
import { canToggleFullscreen } from "../platform/capabilities";

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
