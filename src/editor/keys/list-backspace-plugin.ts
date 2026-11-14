import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  Plugin,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeyEvent } from "./ime";

/**
 * Backspace at the start of a numbered item takes its number away: the
 * item becomes body text between two lists, and the items after it start
 * again from 1, as in Typora. Null where it isn't such a start.
 */
function unnumberItem(state: EditorState) {
  const { $from, empty } = state.selection;
  const d = $from.depth;
  if (!empty || $from.parentOffset !== 0 || d < 3) return null;
  const item = $from.node(d - 1);
  const list = $from.node(d - 2);
  if (item.type.name !== "list_item" || list.type.name !== "ordered_list")
    return null;
  if ($from.index(d - 1) !== 0) return null;
  const at = $from.index(d - 2);
  const items: ProseNode[] = [];
  list.forEach((child) => items.push(child));
  const parts: ProseNode[] = [];
  if (at > 0) parts.push(list.copy(Fragment.from(items.slice(0, at))));
  const textAt = $from.before(d - 2) + (parts[0]?.nodeSize ?? 0);
  item.content.forEach((block) => parts.push(block));
  if (at + 1 < items.length)
    parts.push(
      list.type.create(
        { ...list.attrs, order: 1 },
        Fragment.from(items.slice(at + 1)),
      ),
    );
  const tr = state.tr.replaceWith(
    $from.before(d - 2),
    $from.after(d - 2),
    parts,
  );
  return tr
    .setSelection(TextSelection.create(tr.doc, textAt + 1))
    .scrollIntoView();
}

export const listBackspacePlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Backspace" || isImeKeyEvent(view, event))
            return false;
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
            return false;
          const tr = unnumberItem(view.state);
          if (!tr) return false;
          view.dispatch(tr);
          return true;
        },
      },
    }),
);
