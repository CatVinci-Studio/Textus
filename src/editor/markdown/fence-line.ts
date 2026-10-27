import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Attrs, NodeType } from "@milkdown/kit/prose/model";
import { caretAt } from "../marks/enclosure";

/** The typed fence line (```, $$) at `pos` made an empty `type` block, the
 *  caret in it. A list item's first line must stay a paragraph, so there
 *  the block goes below that line, emptied. */
export function fenceLineToBlock(
  state: EditorState,
  pos: number,
  type: NodeType,
  attrs?: Attrs,
): Transaction {
  const line = state.doc.nodeAt(pos)!;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index();
  const tr = state.tr.delete(pos + 1, pos + 1 + line.content.size);
  if ($pos.parent.canReplaceWith(index, index + 1, type)) {
    tr.setNodeMarkup(pos, type, attrs);
    return caretAt(tr, pos + 1);
  }
  tr.insert(pos + 2, type.create(attrs));
  return caretAt(tr, pos + 3);
}
