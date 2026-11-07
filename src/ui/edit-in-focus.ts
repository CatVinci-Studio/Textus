import { editIpc } from "../platform/ipc-app";
import { EDIT_ACTION_EVENT, SOURCE_EDIT_EVENT } from "../utils/events";

/** The Edit menu items that act where the keyboard is. */
export type FocusedEdit = "undo" | "redo" | "select-all";

/**
 * Edit › Undo, Redo or Select All, wherever the keyboard is: a text field,
 * a plugin frame, a web page tab or the chat window does its own; nothing
 * happens behind an open dialog; else the document on screen. Never the
 * whole window, which WebKit's own Select All would take.
 */
export function editInFocus(action: FocusedEdit): void {
  const focused = document.activeElement;
  if (!document.hasFocus() || focused instanceof HTMLIFrameElement) {
    editNatively(action);
    return;
  }
  if (
    focused instanceof HTMLInputElement ||
    focused instanceof HTMLTextAreaElement
  ) {
    if (action === "select-all") focused.select();
    else editNatively(action);
    return;
  }
  // Source mode is a CodeMirror document with its own history: the editor
  // does the edit itself, asked through its content element.
  if (
    focused instanceof HTMLElement &&
    focused.closest(".source-view .cm-content")
  ) {
    focused.dispatchEvent(
      new CustomEvent(SOURCE_EDIT_EVENT, { detail: action, bubbles: true }),
    );
    return;
  }
  if (focused instanceof HTMLElement && focused.closest('[aria-modal="true"]'))
    return;
  window.dispatchEvent(new CustomEvent(EDIT_ACTION_EVENT, { detail: action }));
}

/** As the system's own menu item would. Where there is none, Undo and Redo
 *  fall back on the page's command; Select All does nothing, as the page's
 *  would take the whole window. */
function editNatively(action: FocusedEdit): void {
  void editIpc
    .natively(action)
    .catch(() => false)
    .then((done) => {
      if (!done && action !== "select-all") document.execCommand(action);
    });
}
