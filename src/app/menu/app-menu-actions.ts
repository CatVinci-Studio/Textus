import { thisWindow } from "../../platform/this-window";
import { selectAllInFocus } from "../../ui/select-all";
import { EDIT_ACTION_EVENT } from "../../utils/events";
import type { LocalMenuAction, MenuAction } from "./app-menu-model";
import { canToggleFullscreen, hasAppMenu } from "../../platform/capabilities";
import { emitMenuEvent, runMenuItemHere } from "../../platform/menu-events";

/** Runs a menu entry's action as a click on it would: a native id through
 *  the backend, a local one here. */
export function runMenuAction(action: MenuAction): void {
  if ("local" in action) runLocalMenuAction(action.local);
  else if (!hasAppMenu) emitMenuEvent(action.native);
  else
    void runMenuItemHere(action.native).catch(() => {
      // A failed menu command is the backend's to report.
    });
}

/** Items with no native id to fire (predefined items in the native menu),
 *  run on this side instead. */
export function runLocalMenuAction(action: LocalMenuAction): void {
  if (action === "select-all") {
    selectAllInFocus();
    return;
  }
  if (action === "fullscreen") {
    if (!canToggleFullscreen) return;
    void (async () => {
      const win = thisWindow();
      await win.setFullscreen(!(await win.isFullscreen()));
    })();
    return;
  }
  window.dispatchEvent(new CustomEvent(EDIT_ACTION_EVENT, { detail: action }));
}
