import { Plugin, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { CellSelection, TableMap } from "@milkdown/kit/prose/tables";
import { $prose } from "@milkdown/kit/utils";

/** What the table's view finds among its decorations: the columns the
 *  selection is in. */
export const TABLE_CARET_SPEC = "tableCaret";

/** The table the selection is in, where it starts, and the columns the
 *  caret or the picked cells cover; null outside a table. */
export function caretColumns(
  state: EditorState,
): { pos: number; cols: number[] } | null {
  const { selection } = state;
  const $from = selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const table = $from.node(d);
    if (table.type.spec.tableRole !== "table") continue;
    const start = $from.start(d);
    const map = TableMap.get(table);
    let cols: number[];
    if (selection instanceof CellSelection) {
      const rect = map.rectBetween(
        selection.$anchorCell.pos - start,
        selection.$headCell.pos - start,
      );
      cols = [];
      for (let c = rect.left; c < rect.right; c++) cols.push(c);
    } else if (d + 2 <= $from.depth) {
      cols = [map.colCount($from.before(d + 2) - start)];
    } else cols = [];
    return { pos: $from.before(d), cols };
  }
  return null;
}

/** The decoration marking the caret's table in `state`, if it is in one. */
function caretDecorations(state: EditorState): DecorationSet {
  const at = caretColumns(state);
  const table = at && state.doc.nodeAt(at.pos);
  if (!at || !table) return DecorationSet.empty;
  return DecorationSet.create(state.doc, [
    Decoration.node(
      at.pos,
      at.pos + table.nodeSize,
      { class: "is-table-caret" },
      { [TABLE_CARET_SPEC]: at.cols },
    ),
  ]);
}

const sameCols = (a: DecorationSet, b: DecorationSet) => {
  const [x] = a.find();
  const [y] = b.find();
  if (!x || !y) return !x && !y;
  const cols = (d: typeof x) =>
    String((d.spec as Record<string, unknown>)[TABLE_CARET_SPEC]);
  return x.from === y.from && x.to === y.to && cols(x) === cols(y);
};

/**
 * Marks the table the selection is in (`is-table-caret`), with the columns
 * it covers: its tools show while the caret is in it, a phone's without a
 * hover, and its alignment buttons act on those columns. The set is kept
 * while it is the same: a new one redraws the table and puts the state's
 * selection back in the page, under a finger's tap that was moving it.
 */
export const tableCaretPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      state: {
        init: (_, state) => caretDecorations(state),
        apply(tr, old, _prev, state) {
          if (!tr.docChanged && !tr.selectionSet) return old;
          const next = caretDecorations(state);
          return !tr.docChanged && sameCols(old, next) ? old : next;
        },
      },
      props: {
        decorations(state) {
          return this.getState(state);
        },
      },
    }),
);
