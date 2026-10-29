import { EDIT_ACTION_EVENT } from "../utils/events";

/** Edit › Undo or Redo, wherever the keyboard is: the focused field's own
 *  history, nothing behind an open dialog, else the document's. */
export function undoInFocus(action: "undo" | "redo"): void {
  const focused = document.activeElement;
  if (
    focused instanceof HTMLInputElement ||
    focused instanceof HTMLTextAreaElement
  ) {
    document.execCommand(action);
    return;
  }
  if (focused instanceof HTMLElement && focused.closest('[aria-modal="true"]'))
    return;
  window.dispatchEvent(new CustomEvent(EDIT_ACTION_EVENT, { detail: action }));
}
