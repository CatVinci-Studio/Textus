import type { ResolvedPos } from "@milkdown/kit/prose/model";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { tableEditing } from "@milkdown/kit/prose/tables";
import { $prose } from "@milkdown/kit/utils";

/** The table holding `$pos`'s cell, if it is in one. */
function tableOfCell($pos: ResolvedPos): number | null {
  for (let d = $pos.depth; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") return $pos.before(d - 1);
  }
  return null;
}

/**
 * prosemirror-tables' editing, its text selections tidied only inside one
 * table. Its rule pulls a selection whose end is at a cell's start back to
 * the block it began in; from outside the table that undid a drag or a
 * Shift+Down into it, and Select All ending in an empty cell.
 */
export const tableEditingInTables = $prose(() => {
  const base = tableEditing({ allowTableNodeSelection: true });
  const append = base.spec.appendTransaction!;
  return new Plugin({
    ...base.spec,
    appendTransaction(trs, oldState, state) {
      const tr = append.call(base, trs, oldState, state);
      if (!tr || tr.docChanged) return tr;
      const { selection } = state;
      if (!(selection instanceof TextSelection)) return tr;
      const table = tableOfCell(selection.$from);
      return table != null && table === tableOfCell(selection.$to) ? tr : null;
    },
  });
});
