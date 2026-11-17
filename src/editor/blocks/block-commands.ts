import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  type EditorState,
  Selection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { closeHistory } from "@milkdown/kit/prose/history";

/** A block a handle stands for: a list item (its own list inside it), or
 *  a block of the document - a quote or a callout whole. */
export interface HandledBlock {
  pos: number;
  node: ProseNode;
}

const LISTS = /^(bullet_list|ordered_list)$/;
const isItem = (node: ProseNode) => node.type.name === "list_item";

/** The handled block around `pos`, or the block (a rule, a formula) that
 *  starts there. */
export function blockAround(doc: ProseNode, pos: number): HandledBlock | null {
  const at = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(at);
  for (let depth = $pos.depth; depth > 0; depth--)
    if (isItem($pos.node(depth)))
      return { pos: $pos.before(depth), node: $pos.node(depth) };
  if ($pos.depth > 0) return { pos: $pos.before(1), node: $pos.node(1) };
  const leaf = doc.nodeAt(at);
  return leaf?.isBlock ? { pos: at, node: leaf } : null;
}

/** The range a block goes from when it leaves: a list's only item takes
 *  its list along. */
function ownRange(state: EditorState, block: HandledBlock) {
  const $pos = state.doc.resolve(block.pos);
  if (isItem(block.node) && $pos.parent.childCount === 1)
    return { from: $pos.before(), to: $pos.after() };
  return { from: block.pos, to: block.pos + block.node.nodeSize };
}

/** The caret at the start of the block's first line, for a command that
 *  works where the caret is (Turn Into). */
export function caretInto(state: EditorState, pos: number): Transaction {
  const $at = state.doc.resolve(Math.min(pos + 1, state.doc.content.size));
  return state.tr.setSelection(Selection.near($at));
}

export function deleteBlock(
  state: EditorState,
  block: HandledBlock,
): Transaction {
  const { from, to } = ownRange(state, block);
  const tr = state.tr.delete(from, to);
  // The document keeps a line to write on.
  if (tr.doc.childCount === 0)
    tr.insert(0, state.schema.nodes.paragraph!.create());
  return closeHistory(tr).setSelection(
    Selection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))),
  );
}

// Each a step of its own on the undo list, however soon after the last.

/** A copy right after it, the selection kept where it was. */
export function duplicateBlock(
  state: EditorState,
  block: HandledBlock,
): Transaction {
  return closeHistory(
    state.tr.insert(block.pos + block.node.nodeSize, block.node),
  );
}

/** Where a block can be put: before or after each child of the document,
 *  and (a list item) of a list. */
interface Gap {
  pos: number;
  /** The container the gap is in, for its left edge. */
  container: number;
}

/** Every place a block can go in `doc`; a list item (`items`) also
 *  between the items of each list - and not just outside one, a place
 *  the list's own first or last place stands at already. */
export function gapsIn(doc: ProseNode, items: boolean): Gap[] {
  const gaps: Gap[] = [];
  const list = (node: ProseNode | null) => !!node && LISTS.test(node.type.name);
  const collect = (node: ProseNode, start: number, container: number) => {
    let offset = start;
    for (let i = 0; i <= node.childCount; i++) {
      const beside =
        items &&
        container < 0 &&
        (list(i > 0 ? node.child(i - 1) : null) ||
          list(i < node.childCount ? node.child(i) : null));
      if (!beside) gaps.push({ pos: offset, container });
      if (i < node.childCount) offset += node.child(i).nodeSize;
    }
  };
  collect(doc, 0, -1);
  doc.descendants((node, pos) => {
    if (items && LISTS.test(node.type.name)) collect(node, pos + 1, pos);
    return !node.isTextblock;
  });
  return gaps;
}

export function gapsFor(doc: ProseNode, block: HandledBlock): Gap[] {
  const end = block.pos + block.node.nodeSize;
  // Inside itself, or where it already is, is no move.
  return gapsIn(doc, isItem(block.node)).filter(
    (gap) => gap.pos <= block.pos || gap.pos >= end,
  );
}

/** What `block` is to be put down as at `gap` in `state`'s document (which
 *  may be another document's): a list item put outside a list goes in a
 *  list of its own kind. Null where it can't go. */
function placed(
  state: EditorState,
  from: EditorState,
  block: HandledBlock,
  gap: number,
): ProseNode | null {
  const $gap = state.doc.resolve(gap);
  let moving = block.node;
  if (isItem(moving) && !LISTS.test($gap.parent.type.name)) {
    const list = from.doc.resolve(block.pos).parent;
    moving = list.type.create(list.attrs, moving);
  }
  // Another editor's nodes are of its own schema.
  if (state.schema !== from.schema)
    moving = state.schema.nodeFromJSON(moving.toJSON());
  const index = $gap.index();
  return $gap.parent.canReplace(index, index, Fragment.from(moving))
    ? moving
    : null;
}

/** `block` of `from`'s document put down at `gap` in `state`'s (another
 *  document, or a copy in its own), one undo step, selected. Null where
 *  it can't go. */
export function placeAt(
  state: EditorState,
  from: EditorState,
  block: HandledBlock,
  gap: number,
): Transaction | null {
  const moving = placed(state, from, block, gap);
  if (!moving) return null;
  return landed(closeHistory(state.tr).insert(gap, moving), gap, moving);
}

/** The block moved to `gap`, one undo step: a list item put outside a
 *  list goes in a list of its own kind. Null where it can't go. */
export function moveTo(
  state: EditorState,
  block: HandledBlock,
  gap: number,
): Transaction | null {
  const { from, to } = ownRange(state, block);
  if (gap >= from && gap <= to) return null;
  const moving = placed(state, state, block, gap);
  if (!moving) return null;
  const tr = closeHistory(state.tr);
  if (gap > from) tr.insert(gap, moving).delete(from, to);
  else tr.delete(from, to).insert(gap, moving);
  return landed(tr, gap > from ? gap - (to - from) : gap, moving);
}

/** Where a block put down by `moveTo` or `placeAt` now starts. */
export const landedAt = (tr: Transaction): number | null =>
  tr.getMeta(LANDED) ?? null;

const LANDED = "block-landed";

/** The caret at the end of the block put down at `at` - not the block
 *  picked whole, which drew its selected frame round it. */
const landed = (tr: Transaction, at: number, node: ProseNode) =>
  tr
    .setSelection(Selection.near(tr.doc.resolve(at + node.nodeSize), -1))
    .setMeta(LANDED, at)
    .scrollIntoView();
