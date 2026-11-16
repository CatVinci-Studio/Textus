import {
  Fragment,
  type Node as ProseNode,
  type Schema,
} from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { isInTable, selectedRect } from "@milkdown/kit/prose/tables";
import { fillTableAt } from "../clipboard/paste-slice";

/** The caret's row and column in its table, the table's start and size. */
export function here(state: EditorState) {
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

type PastedRows = { rows: Fragment[]; width: number; height: number };

/**
 * The rows of cells pasted, top to bottom, however the clipboard's table
 * was parsed back (a head row of its own, a table inside it); null when
 * no cells came. A head row made empty to fill a table is left out.
 */
export function pastedRows(content: Fragment): PastedRows | null {
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
export function tabbedRows(text: string, schema: Schema): PastedRows | null {
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

/** `rows` each as wide as the widest, or as the same rows' tab-separated
 *  text says: iOS drops a row's empty cells at its end from the HTML. */
export function fullWidth(
  rows: PastedRows,
  tabbed: PastedRows | null,
  schema: Schema,
): PastedRows {
  const width =
    tabbed?.height === rows.height
      ? Math.max(rows.width, tabbed.width)
      : rows.width;
  const empty = () => schema.nodes.table_cell!.createAndFill()!;
  return {
    ...rows,
    width,
    rows: rows.rows.map((row) =>
      row.append(
        Fragment.from(Array.from({ length: width - row.childCount }, empty)),
      ),
    ),
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
 * Rows pasted with the caret in a table, wherever they were copied from
 * (a table's HTML, tab-separated text, Markdown): rows as wide as the table
 * go in as new rows under the caret's; whole columns (as tall as the
 * table), as columns after its column. Any other shape is written over
 * from the caret's cell. Null outside a table.
 */
export function pasteRows(
  state: EditorState,
  cells: PastedRows,
): Transaction | null {
  const at = here(state);
  if (!at) return null;
  const table = state.doc.nodeAt(at.tablePos)!;
  const head = table.firstChild!;
  const align = (col: number) => head.maybeChild(col)?.attrs.alignment ?? null;
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
        asCells(cells.rows[r]!, r === 0 ? types.head : types.cell, () => null),
      );
    }
  } else {
    // The table grows where the cells run past it.
    fillTableAt(
      tr,
      at.tablePos,
      at.row,
      at.col,
      table.type.create(
        null,
        cells.rows.map((row) => types.row.create(null, row)),
      ),
    );
  }
  return tr;
}
