import { EDIT_ACTION_EVENT } from "../utils/events";

/**
 * Edit › Select All, wherever the keyboard is: all of the text field or
 * source view that has it, nothing behind an open dialog, and otherwise
 * the document in front - never the window itself, whose notes and
 * empty boxes WebKit's own Select All took along (menu.rs's SELECT_ALL_ID
 * sends macOS's here too).
 */
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
