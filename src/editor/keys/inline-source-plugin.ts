import { Plugin, type Command } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { stateWithLiveSelection } from "../live-selection";
import { isImeKeyEvent } from "./ime";
import { isEnclosure } from "../marks/enclosure-runs";

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

const onKey: Record<string, Command> = {
  Backspace: backspaceIntoSource,
  Delete: deleteIntoSource,
};

export const inlineSourcePlugin = $prose(
  () =>
    new Plugin({
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
