import { clipboardIpc } from "../platform/ipc-app";
import { EDIT_ACTION_EVENT } from "../utils/events";

/** Edit › Undo or Redo, wherever the keyboard is: a text field's or a
 *  plugin frame's own history, nothing behind an open dialog, else the
 *  document's. */
export function undoInFocus(action: "undo" | "redo"): void {
  const focused = document.activeElement;
  if (
    focused instanceof HTMLInputElement ||
    focused instanceof HTMLTextAreaElement ||
    focused instanceof HTMLIFrameElement
  ) {
    void clipboardIpc
      .undoNatively(action === "redo")
      .catch(() => false)
      .then((done) => done || document.execCommand(action));
    return;
  }
  if (focused instanceof HTMLElement && focused.closest('[aria-modal="true"]'))
    return;
  window.dispatchEvent(new CustomEvent(EDIT_ACTION_EVENT, { detail: action }));
}
