import { PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { FlashLabel } from "./editor-flash";
import { held } from "./key-holder";

/**
 * What the keyboard plugin's capture (editor-input.ts) and its editing
 * actions (editor-ops.ts) share: who holds the keys, the editor, Visual
 * mode, the cursor and flash's marks.
 */

/** The selection from character `anchor` to character `head`, both in. */
export function visualSelection(
  state: EditorState,
  anchor: number,
  head: number,
) {
  const doc = state.doc;
  const after = (p: number) => {
    const $p = doc.resolve(p);
    return Math.min(p + 1, $p.parent.isTextblock ? $p.end() : p);
  };
  return head >= anchor
    ? TextSelection.create(doc, anchor, after(head))
    : TextSelection.create(doc, after(anchor), head);
}

/** How long after a key it was handed a plugin's actions are taken. */
export const ACT_WITHIN_MS = 3000;

export interface InputState {
  cursor: "bar" | "block";
  labels: FlashLabel[];
  /** What flash found, lit while it waits for a label. */
  matches: { from: number; to: number }[];
}

export const inputKey = new PluginKey<InputState>("plugin-editor-input");

export function setCursorStyle(style: "bar" | "block") {
  held.cursorStyle = style;
  const view = held.view;
  if (!view || view.isDestroyed) return;
  if (inputKey.getState(view.state)?.cursor === style) return;
  view.dispatch(view.state.tr.setMeta(inputKey, { cursor: style }));
}

export function clearFlash() {
  const view = held.view;
  if (!view || view.isDestroyed) return;
  view.dispatch(view.state.tr.setMeta(inputKey, NO_FLASH));
}

export const NO_FLASH: Partial<InputState> = { labels: [], matches: [] };
