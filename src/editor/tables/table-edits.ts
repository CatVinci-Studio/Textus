import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";
import { TableMap } from "@milkdown/kit/prose/tables";

/** A column's alignment as GFM stores it (`:---`, `:---:`, `---:`). */
export type Alignment = "left" | "center" | "right";

/** The fewest a table keeps: its head row and one more, and one column. */
const LEAST_ROWS = 2;
const LEAST_COLUMNS = 1;

/** Its rows (the head row counted) and columns. */
export function tableSize(table: ProseNode): { rows: number; cols: number } {
  return { rows: table.childCount, cols: TableMap.get(table).width };
}

/** The alignment `cols` share in the table at `pos`, null when they differ
 *  or have none. */
export function sharedAlignment(
  table: ProseNode,
  cols: readonly number[],
): Alignment | null {
  const head = table.firstChild;
  if (!head || !cols.length) return null;
  const found = new Set(
    cols.map((c) => head.maybeChild(c)?.attrs.alignment ?? null),
  );
  const [only] = found;
  return found.size === 1 && only ? (only as Alignment) : null;
}

/** Every cell of `cols`, head to foot, set to `alignment`. */
export function alignColumns(
  tr: Transaction,
  tablePos: number,
  cols: readonly number[],
  alignment: Alignment,
): Transaction {
  const table = tr.doc.nodeAt(tablePos);
  if (!table) return tr;
  const map = TableMap.get(table);
  for (let row = 0; row < map.height; row++)
    for (const col of cols) {
      const at = map.map[row * map.width + col];
      const cell = at === undefined ? null : table.nodeAt(at);
      if (cell)
        tr.setNodeMarkup(tablePos + 1 + at, null, { ...cell.attrs, alignment });
    }
  return tr;
}

/**
 * The table at `tablePos` grown or cut to `rows` and `cols`, at its end:
 * new cells empty, a new row's cells aligned as their columns are. Never
 * fewer than its head row and one more, and one column.
 */
export function resizeTable(
  tr: Transaction,
  tablePos: number,
  rows: number,
  cols: number,
): Transaction {
  const want = {
    rows: Math.max(LEAST_ROWS, rows),
    cols: Math.max(LEAST_COLUMNS, cols),
  };
  let table = tr.doc.nodeAt(tablePos);
  if (!table) return tr;
  const width = TableMap.get(table).width;
  // Columns first, each row from the last up so the ones above keep their
  // places.
  if (want.cols !== width) {
    for (let r = table.childCount - 1; r >= 0; r--) {
      table = tr.doc.nodeAt(tablePos)!;
      let rowPos = tablePos + 1;
      for (let i = 0; i < r; i++) rowPos += table.child(i).nodeSize;
      const row = table.child(r);
      const rowEnd = rowPos + row.nodeSize - 1;
      if (want.cols < width) {
        let cut = rowPos + 1;
        for (let c = 0; c < want.cols; c++) cut += row.child(c).nodeSize;
        tr.delete(cut, rowEnd);
      } else {
        const type = row.child(row.childCount - 1).type;
        const added = Array.from({ length: want.cols - width }, () =>
          type.createAndFill({ alignment: null })!,
        );
        tr.insert(rowEnd, added);
      }
    }
  }
  table = tr.doc.nodeAt(tablePos)!;
  const end = tablePos + table.nodeSize - 1;
  if (want.rows < table.childCount) {
    let cut = tablePos + 1;
    for (let r = 0; r < want.rows; r++) cut += table.child(r).nodeSize;
    tr.delete(cut, end);
  } else if (want.rows > table.childCount) {
    const last = table.lastChild!;
    const head = table.firstChild!;
    const rowsToAdd = Array.from({ length: want.rows - table.childCount }, () =>
      last.type.create(
        null,
        Array.from({ length: want.cols }, (_, c) =>
          last.child(Math.min(c, last.childCount - 1)).type.createAndFill({
            alignment: head.maybeChild(c)?.attrs.alignment ?? null,
          })!,
        ),
      ),
    );
    tr.insert(end, rowsToAdd);
  }
  return tr;
}
