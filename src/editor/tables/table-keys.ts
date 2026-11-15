import {
  Fragment,
  type Node as ProseNode,
  type Schema,
} from "@milkdown/kit/prose/model";
import {
  Plugin,
  type Command,
  type EditorState,
} from "@milkdown/kit/prose/state";
import {
  CellSelection,
  deleteColumn,
  deleteRow,
  isInTable,
  moveTableColumn,
  moveTableRow,
  selectedRect,
} from "@milkdown/kit/prose/tables";
import { keymap } from "@milkdown/kit/prose/keymap";
import { $prose } from "@milkdown/kit/utils";

/** The caret's row and column in its table, the table's start and size. */
function here(state: EditorState) {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  return {
    row: rect.top,
    col: rect.left,
    rect,
    tablePos: rect.tableStart - 1,
    width: rect.map.width,
    height: rect.map.height,
  };
}

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

/**
 * The rows of cells pasted, top to bottom, however the clipboard's table
 * was parsed back (a head row of its own, a table inside it); null when
 * no cells came. A head row made empty to fill a table is left out.
 */
function pastedRows(
  content: Fragment,
): { rows: Fragment[]; width: number; height: number } | null {
  const rows: Fragment[] = [];
  content.descendants((node) => {
    const role = node.type.spec.tableRole as string | undefined;
    if (role === "row" || role === "header_row") {
      rows.push(node.content);
      return false;
    }
    return true;
  });
  const [first] = rows;
  if (rows.length > 1 && first && !first.textBetween(0, first.size).trim())
    rows.shift();
  if (!rows.length) return null;
  return {
    rows,
    width: Math.max(...rows.map((r) => r.childCount)),
    height: rows.length,
  };
}

/** Lines of tab-separated cells, as a table's cells copy as plain text
 *  (a phone's paste gives only that): each line a row. */
function tabbedRows(
  text: string,
  schema: Schema,
): { rows: Fragment[]; width: number; height: number } | null {
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  if (!lines.every((line) => line.includes("\t"))) return null;
  const cell = (value: string) =>
    schema.nodes.table_cell!.create(
      null,
      schema.nodes.paragraph!.create(null, value ? schema.text(value) : null),
    );
  const rows = lines.map((line) => Fragment.from(line.split("\t").map(cell)));
  return {
    rows,
    width: Math.max(...rows.map((r) => r.childCount)),
    height: rows.length,
  };
}

/** `cells` as cells of `type`, each aligned as its column `aligns`. */
function asCells(
  cells: Fragment,
  type: ProseNode["type"],
  aligns: (col: number) => unknown,
  from = 0,
): ProseNode[] {
  const out: ProseNode[] = [];
  cells.forEach((cell, _, i) =>
    out.push(
      type.create({ ...cell.attrs, alignment: aligns(from + i) }, cell.content),
    ),
  );
  return out;
}

/**
 * Whole rows pasted with the caret in a table go in as rows under the
 * caret's; whole columns (as tall as the table), as columns after its
 * column. Picked cells, or fewer, are written over as before.
 */
export const tableRowPaste = $prose(
  () =>
    new Plugin({
      props: {
        handlePaste(view, event, slice) {
          const { state } = view;
          if (state.selection instanceof CellSelection) return false;
          const at = here(state);
          const text = event.clipboardData?.getData("text/plain") ?? "";
          const cells =
            at &&
            (pastedRows(slice.content) ??
              (event.clipboardData?.getData("text/html")
                ? null
                : tabbedRows(text, state.schema)));
          if (!at || !cells) return false;
          const table = state.doc.nodeAt(at.tablePos)!;
          const head = table.firstChild!;
          const align = (col: number) =>
            head.maybeChild(col)?.attrs.alignment ?? null;
          // From the schema: a table of its head row alone has no body
          // row to copy them from.
          const { nodes } = state.schema;
          const types = {
            row: nodes.table_row!,
            cell: nodes.table_cell!,
            head: head.firstChild!.type,
          };
          const tr = state.tr;
          if (cells.width === at.width) {
            let pos = at.tablePos + 1;
            for (let r = 0; r <= at.row; r++) pos += table.child(r).nodeSize;
            tr.insert(
              pos,
              cells.rows.map((row) =>
                types.row.create(null, asCells(row, types.cell, align)),
              ),
            );
          } else if (cells.height === at.height && cells.width < at.width) {
            // From the last row up, so the rows above keep their places.
            for (let r = at.height - 1; r >= 0; r--) {
              let pos = at.tablePos + 1;
              for (let i = 0; i < r; i++) pos += table.child(i).nodeSize;
              const row = table.child(r);
              pos += 1;
              for (let c = 0; c <= at.col; c++) pos += row.child(c).nodeSize;
              tr.insert(
                pos,
                asCells(
                  cells.rows[r]!,
                  r === 0 ? types.head : types.cell,
                  () => null,
                ),
              );
            }
          } else return false;
          view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"));
          return true;
        },
      },
    }),
);
