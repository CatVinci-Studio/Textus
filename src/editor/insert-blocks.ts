import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

/** The caret's textblock is replaced by `node` when it is empty, else
 *  `node` goes after it; the caret lands in `node` (or after a leaf, in a
 *  new paragraph). False where it can't go. */
function placeBlock(view: EditorView, node: ProseNode): boolean {
  const { state } = view;
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth--;
  if (depth === 0) return false;
  const block = $from.node(depth);
  const empty = block.content.size === 0 && !block.type.spec.code;
  const from = empty ? $from.before(depth) : $from.after(depth);
  const to = empty ? $from.after(depth) : from;
  let tr: Transaction = state.tr.replaceWith(from, to, node);
  if (node.isLeaf) {
    const after = from + node.nodeSize;
    const paragraph = state.schema.nodes.paragraph!.create();
    tr = tr.insert(after, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
  } else tr.setSelection(TextSelection.create(tr.doc, from + 1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** A display formula, caret inside it. */
export function insertMathBlock(view: EditorView): boolean {
  const math = view.state.schema.nodes.math_block;
  return !!math && placeBlock(view, math.create());
}

/** A thematic break (`---`), then a paragraph to go on in. */
export function insertRule(view: EditorView): boolean {
  const hr = view.state.schema.nodes.hr;
  return !!hr && placeBlock(view, hr.create());
}

/** The bullet list at the caret's items become tasks, unticked; ones
 *  already tasks stay as they are. */
export function makeTasks(view: EditorView): boolean {
  const { state } = view;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const list = $from.node(depth);
    if (list.type.name !== "bullet_list") continue;
    const start = $from.before(depth) + 1;
    const tr = state.tr;
    list.forEach((item, offset) => {
      if (item.attrs.checked == null)
        tr.setNodeMarkup(start + offset, undefined, {
          ...item.attrs,
          checked: false,
        });
    });
    view.dispatch(tr);
    return true;
  }
  return false;
}
