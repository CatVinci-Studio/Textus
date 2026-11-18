import type { EditorView } from "@milkdown/kit/prose/view";
import { isMobileApp } from "../platform/capabilities";
import { hardwareKeyboard } from "../platform/hardware-keyboard";

/**
 * Whether the app may give an editor the keys on its own (a jump, a tab
 * brought to the front): always, but on a phone or tablet only while its
 * keyboard is up or a hardware one is connected. With neither a document
 * is read first; a tap in the text brings the keyboard.
 */
export const mayTakeKeys = (): boolean =>
  !isMobileApp ||
  hardwareKeyboard() ||
  document.documentElement.classList.contains("keyboard-up");

export function takeKeys(view: EditorView): void {
  if (mayTakeKeys()) view.focus();
}
