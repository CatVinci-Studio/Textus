import { lift, setBlockType, wrapIn } from "@milkdown/kit/prose/commands";
import { liftListItem, wrapInList } from "@milkdown/kit/prose/schema-list";
import type { NodeType } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

/**
 * The iPhone keyboard toolbar's block buttons, which must also undo
 * themselves: H cycles paragraph, H1-H3; a list or quote button tapped again
 * inside its own kind takes the block back out.
 */
const LAST_LEVEL = 3;

export function cycleHeading(view: EditorView): boolean {
  const { state } = view;
  const { heading, paragraph } = state.schema.nodes;
  if (!heading || !paragraph) return false;
  const block = state.selection.$from.parent;
  const command =
    block.type === heading
      ? block.attrs.level >= LAST_LEVEL
        ? setBlockType(paragraph)
        : setBlockType(heading, { level: block.attrs.level + 1 })
      : setBlockType(heading, { level: 1 });
  return command(state, view.dispatch);
}

/** The list the caret is directly in, if any (its nearest list item's). */
function enclosingList(view: EditorView): NodeType | null {
  const { $from } = view.state.selection;
  const item = view.state.schema.nodes.list_item;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === item) return $from.node(d - 1).type;
  }
  return null;
}

export function toggleList(
  view: EditorView,
  kind: "bullet_list" | "ordered_list",
): boolean {
  const { schema } = view.state;
  const target = schema.nodes[kind];
  const item = schema.nodes.list_item;
  if (!target || !item) return false;
  const current = enclosingList(view);
  if (current) {
    liftListItem(item)(view.state, view.dispatch);
    // Out of the list of this kind: done. Out of the other kind: re-wrap.
    if (current === target) return true;
  }
  // A list item has to start with a paragraph: a heading becomes one.
  const { heading, paragraph } = schema.nodes;
  if (
    heading &&
    paragraph &&
    view.state.selection.$from.parent.type === heading
  )
    setBlockType(paragraph)(view.state, view.dispatch);
  return wrapInList(target)(view.state, view.dispatch);
}

export function toggleBlockquote(view: EditorView): boolean {
  const quote = view.state.schema.nodes.blockquote;
  if (!quote) return false;
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === quote) return lift(view.state, view.dispatch);
  }
  return wrapIn(quote)(view.state, view.dispatch);
}

/** The Format menu's list items in a list of the other kind: the list
 *  changes kind, nesting kept. False outside a list, or in one of that kind. */
export function convertList(
  view: EditorView,
  kind: "bullet_list" | "ordered_list",
): boolean {
  const { state } = view;
  const target = state.schema.nodes[kind];
  const item = state.schema.nodes.list_item;
  if (!target || !item) return false;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 1; d--) {
    if ($from.node(d).type !== item) continue;
    const list = $from.node(d - 1);
    if (list.type === target) return false;
    view.dispatch(
      state.tr.setNodeMarkup($from.before(d - 1), target, {
        spread: list.attrs.spread,
      }),
    );
    return true;
  }
  return false;
}
