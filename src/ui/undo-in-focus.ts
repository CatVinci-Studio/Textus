import { clipboardIpc } from "../platform/ipc-app";
import { EDIT_ACTION_EVENT } from "../utils/events";

/** Edit › Undo or Redo, wherever the keyboard is: the own history of a
 *  text field, a plugin frame, a web page tab or the chat window, nothing
 *  behind an open dialog, else the document's. */
export function undoInFocus(action: "undo" | "redo"): void {
  const focused = document.activeElement;
  if (
    !document.hasFocus() ||
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
