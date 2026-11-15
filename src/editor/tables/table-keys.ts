import { Plugin, type Command } from "@milkdown/kit/prose/state";
import {
  CellSelection,
  deleteColumn,
  deleteRow,
  moveTableColumn,
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

/** Alt+↑/↓ moves the caret's row past the next (never above the head
 *  row), Alt+←/→ its column; outside a table the keys move blocks. */
function move(axis: "row" | "col", by: -1 | 1): Command {
  return (state, dispatch) => {
    const at = here(state);
    if (!at) return false;
    const from = axis === "row" ? at.row : at.col;
    const to = from + by;
    const last = (axis === "row" ? at.height : at.width) - 1;
    if (axis === "row" && (from === 0 || to === 0)) return true;
    if (to < 0 || to > last) return true;
    const command = axis === "row" ? moveTableRow : moveTableColumn;
    return command({ from, to, pos: at.tablePos + 1, select: true })(
      state,
      dispatch,
    );
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
    "Alt-ArrowUp": move("row", -1),
    "Alt-ArrowDown": move("row", 1),
    "Alt-ArrowLeft": move("col", -1),
    "Alt-ArrowRight": move("col", 1),
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
