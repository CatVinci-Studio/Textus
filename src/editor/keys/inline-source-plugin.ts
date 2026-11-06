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
import { hiddenLinkParts } from "../markdown/link-syntax";

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

/** Each bracketed source's edges as offsets in its text, the shown part's
 *  while `hidden`; -1 or Infinity for an edge it lacks. */
const SOURCE_EDGES: Record<
  string,
  (text: string, hidden: boolean) => [number, number]
> = {
  wikilink: (text, hidden) => {
    const parts = hidden ? hiddenParts(text) : null;
    return [
      /^\[\[/.test(text) ? (parts ? parts[0][1] : 0) : -1,
      text.endsWith("]]") ? (parts ? parts[1][0] : text.length) : Infinity,
    ];
  },
  obsidian_embed: (text) => [
    /^!\[\[/.test(text) ? 0 : -1,
    text.endsWith("]]") ? text.length : Infinity,
  ],
  link: (text, hidden) => {
    const parts = hiddenLinkParts(text);
    if (!parts) return [-1, Infinity];
    if (!hidden || parts.length < 2) return [0, text.length];
    return [parts[0][1], parts[parts.length - 1][0]];
  },
};

/** A caret on the outer side of a wikilink's, embed's or link's brackets,
 *  but in it: where it belongs, after or before the node; null elsewhere.
 *  With `hidden`, the brackets weren't drawn, so the shown text's own ends
 *  count. */
export function outsideBrackets(
  $pos: ResolvedPos,
  hidden = false,
): number | null {
  const node = $pos.parent;
  const edges = SOURCE_EDGES[node.type.name];
  if (!edges) return null;
  const [start, end] = edges(node.textContent, hidden);
  if ($pos.parentOffset >= end) return $pos.after();
  if ($pos.parentOffset <= start) return $pos.before();
  return null;
}

/** WebKit puts a click at a wikilink's or link's end inside it, so what was
 *  typed next joined it and Enter split it; the click lands outside instead. */
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
