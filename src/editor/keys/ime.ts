import type { EditorView } from "@milkdown/kit/prose/view";
import { isImeKeydown } from "../../utils/ime";

/**
 * Whether a keydown belongs to an active IME composition. Every
 * handleKeyDown must bail on these, or the raw preedit is committed.
 */
export function isImeKeyEvent(view: EditorView, event: KeyboardEvent): boolean {
  return view.composing || isImeKeydown(event);
}
