import {
  NodeSelection,
  TextSelection,
  type Command,
  type Selection,
} from "@milkdown/kit/prose/state";
import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";
import { keymap } from "@milkdown/kit/prose/keymap";
import { $prose } from "@milkdown/kit/utils";

/** The depth of the block that moves around `$pos`: its list item, or else
 *  its block in the document, a quote or a callout. */
function movingDepth($pos: ResolvedPos): number {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "list_item") return depth;
    if (
      node.isBlock &&
      /^(doc|blockquote)$/.test($pos.node(depth - 1).type.name)
    )
      return depth;
  }
  return 0;
}

function shifted(selection: Selection, doc: Node, by: number): Selection {
  if (selection instanceof NodeSelection)
    return NodeSelection.create(doc, selection.from + by);
  return TextSelection.create(doc, selection.anchor + by, selection.head + by);
}

/**
 * Alt+Up and Alt+Down: the paragraph, heading or list item the selection
 * is in trades places with the one before or after it, with every block
 * the selection spans in the same parent.
 */
export function moveBlock(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const depth = movingDepth($from);
    if (depth === 0) return false;
    const parent = $from.node(depth - 1);
    const sameParent =
      $to.depth >= depth &&
      $to.node(depth - 1) === parent &&
      $to.before(depth) >= $from.before(depth);
    const first = $from.index(depth - 1);
    const last = sameParent ? $to.index(depth - 1) : first;
    const neighbour = direction < 0 ? first - 1 : last + 1;
    if (neighbour < 0 || neighbour >= parent.childCount) return false;
    if (!dispatch) return true;

    const start = $from.before(depth);
    const end = (sameParent ? $to : $from).after(depth);
    const moving = state.doc.slice(start, end).content;
    const other = parent.child(neighbour);
    const tr = state.tr;
    if (direction < 0) {
      tr.delete(start, end).insert(start - other.nodeSize, moving);
    } else {
      tr.insert(end + other.nodeSize, moving).delete(start, end);
    }
    const by = direction * other.nodeSize;
    dispatch(
      tr.setSelection(shifted(state.selection, tr.doc, by)).scrollIntoView(),
    );
    return true;
  };
}

export const moveBlockPlugin = $prose(() =>
  keymap({ "Alt-ArrowUp": moveBlock(-1), "Alt-ArrowDown": moveBlock(1) }),
);
