import {
  Fragment,
  Slice,
  type Node,
  type NodeType,
  type ResolvedPos,
} from "@milkdown/kit/prose/model";

export function inTableCell($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole as string | undefined;
    if (role === "cell" || role === "header_cell") return true;
  }
  return false;
}

/**
 * Lines pasted into a table cell joined into one paragraph, formatting kept:
 * ProseMirror fits them as a row of cells, replacing the cells after the
 * caret. A copied table or its rows still paste as cells.
 */
export function joinLinesForTableCell(slice: Slice, $pos: ResolvedPos): Slice {
  if (!inTableCell($pos)) return slice;
  let paragraph: Node | null = null;
  for (let d = $pos.depth; d > 0 && !paragraph; d--)
    if ($pos.node(d).isTextblock) paragraph = $pos.node(d);
  if (!paragraph) return slice;
  const lines: Fragment[] = [];
  let table = false;
  slice.content.descendants((node) => {
    const role = node.type.spec.tableRole as string | undefined;
    if (role === "table" || role === "row") table = true;
    if (table || !node.isTextblock) return !table;
    if (node.content.size) lines.push(node.content);
    return false;
  });
  if (table || lines.length < 2) return slice;
  const schema = paragraph.type.schema;
  let content = Fragment.empty;
  lines.forEach((line, i) => {
    if (i) content = content.addToEnd(schema.text(" "));
    line.forEach((child) => {
      content = content.addToEnd(
        child.isText && child.text?.includes("\n")
          ? schema.text(child.text.replace(/\n/g, " "), child.marks)
          : child,
      );
    });
  });
  return new Slice(Fragment.from(paragraph.type.create(null, content)), 1, 1);
}

/**
 * `table` with a pasted table's cells written in from row `top`, column
 * `left` on, as a spreadsheet takes a paste: rows and columns are added
 * where the paste runs past the table. Markdown tables have no spans, so
 * each row is a plain list of cells. The first row keeps header cells.
 */
export function fillTable(
  table: Node,
  top: number,
  left: number,
  pasted: Node,
): Node {
  const header = table.child(0).firstChild!.type;
  const body = table.child(table.childCount - 1).firstChild!.type;
  const bodyRow = table.child(table.childCount - 1).type;
  const rowTypes: NodeType[] = [];
  const grid: (Node | undefined)[][] = [];
  table.forEach((row) => {
    rowTypes.push(row.type);
    const cells: Node[] = [];
    row.forEach((cell) => cells.push(cell));
    grid.push(cells);
  });
  let width = grid[0].length;
  pasted.forEach((row, _, r) => {
    const at = top + r;
    if (at >= grid.length) {
      grid.push([]);
      rowTypes.push(bodyRow);
    }
    row.forEach((cell, __, c) => {
      const type = at === 0 ? header : body;
      grid[at][left + c] = type.create(grid[at][left + c]?.attrs, cell.content);
      width = Math.max(width, left + c + 1);
    });
  });
  const rows = grid.map((cells, r) => {
    const type = r === 0 ? header : body;
    const full = Array.from(
      { length: width },
      (_, c) => cells[c] ?? type.createAndFill()!,
    );
    return rowTypes[r].create(null, full);
  });
  return table.type.create(table.attrs, rows);
}
