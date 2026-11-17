import { Plugin, type Command } from "@milkdown/kit/prose/state";
import {
  CellSelection,
  deleteColumn,
  deleteRow,
  moveTableRow,
} from "@milkdown/kit/prose/tables";
import { keymap } from "@milkdown/kit/prose/keymap";
import { $prose } from "@milkdown/kit/utils";
import {
  fullWidth,
  here,
  pastedRows,
  pasteRows,
  tabbedRows,
} from "./row-paste";

/** Alt+↑/↓ in a table moves the caret's row (never to or from the head
 *  row); outside a table the keys move blocks. Columns move by their grip:
 *  Alt/Option+←/→ is the caret's own, a word at a time. */
function moveRow(by: -1 | 1): Command {
  return (state, dispatch) => {
    const at = here(state);
    if (!at) return false;
    const to = at.row + by;
    if (at.row === 0 || to === 0 || to > at.height - 1) return true;
    return moveTableRow({
      from: at.row,
      to,
      pos: at.tablePos + 1,
      select: true,
    })(state, dispatch);
  };
}

/** Backspace or Delete on whole rows or columns takes them out; on the
 *  whole table, the table. Below the head row only. */
const deletePicked: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof CellSelection)) return false;
  const at = here(state)!;
  const rows = selection.isRowSelection();
  const cols = selection.isColSelection();
  if (rows && cols) {
    const table = state.doc.nodeAt(at.tablePos)!;
    dispatch?.(state.tr.delete(at.tablePos, at.tablePos + table.nodeSize));
    return true;
  }
  if (rows && at.rect.top >= 1) return deleteRow(state, dispatch);
  if (cols) return deleteColumn(state, dispatch);
  return false;
};

export const tableKeys = $prose(() =>
  keymap({
    "Alt-ArrowUp": moveRow(-1),
    "Alt-ArrowDown": moveRow(1),
    Backspace: deletePicked,
    Delete: deletePicked,
  }),
);

/** Whole rows, tab-separated lines or a table's HTML, pasted with the
 *  caret in a table: as {@link pasteRows} places them. */
export const tableRowPaste = $prose(
  () =>
    new Plugin({
      props: {
        handlePaste(view, event, slice) {
          const { state } = view;
          if (state.selection instanceof CellSelection) return false;
          const text = event.clipboardData?.getData("text/plain") ?? "";
          const tabbed = tabbedRows(text, state.schema);
          const html = pastedRows(slice.content);
          const cells = html
            ? fullWidth(html, tabbed, state.schema)
            : event.clipboardData?.getData("text/html")
              ? null
              : tabbed;
          const tr = cells && pasteRows(state, cells);
          if (!tr) return false;
          view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"));
          return true;
        },
      },
    }),
);
