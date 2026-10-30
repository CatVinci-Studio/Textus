import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  AllSelection,
  Plugin,
  Selection,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import { keydownHandler } from "@milkdown/kit/prose/keymap";
import { $prose } from "@milkdown/kit/utils";

/** All of `doc`. WebKit draws no highlight for a selection that starts or
 *  ends beside a code block; there it runs from its first character to its
 *  last. */
function wholeDocument(doc: ProseNode): Selection {
  const start = Selection.atStart(doc);
  const end = Selection.atEnd(doc);
  const codeAtEdge = [doc.firstChild, doc.lastChild].some(
    (node) => node?.type.spec.code,
  );
  return codeAtEdge &&
    start instanceof TextSelection &&
    end instanceof TextSelection
    ? TextSelection.create(doc, start.from, end.to)
    : new AllSelection(doc);
}

/** Select All: in a code or math block its code first, as in Typora and
 *  VS Code; then, or anywhere else, the whole document. */
export function selectAllIn(state: EditorState): Selection {
  const { $from, $to } = state.selection;
  if ($from.parent.type.spec.code && $from.sameParent($to)) {
    const start = $from.start();
    const end = $from.end();
    if (end > start && ($from.pos > start || $to.pos < end))
      return TextSelection.create(state.doc, start, end);
  }
  return wholeDocument(state.doc);
}

/** Mod+A where the keydown reaches the page (Windows, Linux); macOS's Edit
 *  menu takes it first and calls `selectAllIn` itself. */
export const selectAllKeyPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown: keydownHandler({
          "Mod-a": (state, dispatch) => {
            dispatch?.(state.tr.setSelection(selectAllIn(state)));
            return true;
          },
        }),
      },
    }),
);
