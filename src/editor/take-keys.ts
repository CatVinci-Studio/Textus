import type { EditorView } from "@milkdown/kit/prose/view";
import { isPhoneLayout } from "../platform/phone-layout";

/**
 * Whether the app may give an editor the keys on its own (a jump, a tab
 * brought to the front): always, but on a phone only while its keyboard
 * is up. With it down a document is read first; a tap in the text brings
 * the keyboard.
 */
export const mayTakeKeys = (): boolean =>
  !isPhoneLayout() ||
  document.documentElement.classList.contains("keyboard-up");

export function takeKeys(view: EditorView): void {
  if (mayTakeKeys()) view.focus();
}
