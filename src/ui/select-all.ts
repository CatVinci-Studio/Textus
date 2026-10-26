import { EDIT_ACTION_EVENT } from "../utils/events";

/** Edit › Select All, wherever the keyboard is: the focused field or source
 *  view, nothing behind an open dialog, else the document. Never the whole
 *  window, which WebKit's own Select All would take. */
export function selectAllInFocus(): void {
  const focused = document.activeElement;
  if (
    focused instanceof HTMLInputElement ||
    focused instanceof HTMLTextAreaElement
  ) {
    focused.select();
    return;
  }
  if (focused instanceof HTMLElement && focused.closest('[aria-modal="true"]'))
    return;
  window.dispatchEvent(
    new CustomEvent(EDIT_ACTION_EVENT, { detail: "select-all" }),
  );
}
