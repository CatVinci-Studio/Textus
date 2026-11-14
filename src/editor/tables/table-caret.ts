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

/**
 * Marks the table the selection is in (`is-table-caret`), with the columns
 * it covers: its tools show while the caret is in it, a phone's without a
 * hover, and its alignment buttons act on those columns.
 */
export const tableCaretPlugin = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const at = caretColumns(state);
          const table = at && state.doc.nodeAt(at.pos);
          if (!at || !table) return null;
          return DecorationSet.create(state.doc, [
            Decoration.node(
              at.pos,
              at.pos + table.nodeSize,
              { class: "is-table-caret" },
              { [TABLE_CARET_SPEC]: at.cols },
            ),
          ]);
        },
      },
    }),
);
