import {
  Plugin,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { stateWithLiveSelection } from "../live-selection";
import { isImeKeyEvent } from "./ime";
import { cursorTouches, isEnclosure } from "../marks/enclosure-runs";
import { hiddenParts } from "../markdown/wikilink-reveal";

/** A link's source, a wikilink, an embed or raw HTML: text edited as
 *  written, in a node of its own. (Bold, code and maths have their own
 *  delimiter keys: enclosure.ts.) */
const isInlineSource = (node: Node | null | undefined): node is Node =>
  !!node &&
  node.isInline &&
  !node.isText &&
  !!node.type.spec.code &&
  node.content.size > 0 &&
  !isEnclosure(node);

/** Backspace right after one deletes its last character. Left to the
 *  browser, the whole node went: a link, its text and address, at once. */
export const backspaceIntoSource: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !isInlineSource($from.nodeBefore)) return false;
  const end = $from.pos - 1;
  dispatch?.(state.tr.delete(end - 1, end));
  return true;
};

/** Delete right before one deletes its first character. */
export const deleteIntoSource: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !isInlineSource($from.nodeAfter)) return false;
  const start = $from.pos + 1;
  dispatch?.(state.tr.delete(start, start + 1));
  return true;
};

/** A caret on the outer side of a wikilink's or embed's brackets, but in
 *  it: where it belongs, after or before the node; null elsewhere. With
 *  `hidden`, the brackets weren't drawn, so the name's own ends count. */
export function outsideBrackets(
  $pos: ResolvedPos,
  hidden = false,
): number | null {
  const node = $pos.parent;
  if (node.type.name !== "wikilink" && node.type.name !== "obsidian_embed")
    return null;
  const text = node.textContent;
  const parts = hidden && node.type.name === "wikilink" && hiddenParts(text);
  const nameStart = parts ? parts[0][1] : 0;
  const nameEnd = parts ? parts[1][0] : node.content.size;
  if ($pos.parentOffset >= nameEnd && text.endsWith("]]")) return $pos.after();
  if ($pos.parentOffset <= nameStart && /^!?\[\[/.test(text))
    return $pos.before();
  return null;
}

/** WebKit puts a click at a link's end inside it, so what was typed next
 *  joined the link and Enter split it; the click lands outside instead. */
export function clickOutsideBrackets(
  transactions: readonly Transaction[],
  oldState: EditorState,
  state: EditorState,
) {
  const { selection } = state;
  if (!selection.empty || !transactions.some((tr) => tr.getMeta("pointer")))
    return null;
  const { $from } = selection;
  const hidden =
    $from.depth > 0 &&
    !cursorTouches(oldState.selection, $from.before(), $from.after());
  const outside = outsideBrackets($from, hidden);
  if (outside === null) return null;
  return state.tr.setSelection(TextSelection.create(state.doc, outside));
}

const onKey: Record<string, Command> = {
  Backspace: backspaceIntoSource,
  Delete: deleteIntoSource,
};

export const inlineSourcePlugin = $prose(
  () =>
    new Plugin({
      appendTransaction: (transactions, oldState, state) =>
        clickOutsideBrackets(transactions, oldState, state),
      props: {
        handleKeyDown(view, event) {
          if (event.metaKey || event.ctrlKey || event.altKey) return false;
          const command = onKey[event.key];
          if (!command || isImeKeyEvent(view, event)) return false;
          return command(stateWithLiveSelection(view), view.dispatch);
        },
      },
    }),
);
