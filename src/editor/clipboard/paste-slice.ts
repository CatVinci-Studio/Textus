import { TableMap } from "@milkdown/kit/prose/tables";
import { Selection, type Transaction } from "@milkdown/kit/prose/state";
import {
  Fragment,
  Slice,
  type Node,
  type NodeType,
  type ResolvedPos,
} from "@milkdown/kit/prose/model";

import { inTableCell } from "../tables/table-pos";

export { inTableCell };

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
  // A new cell takes its column's alignment, as the table keeps it: else
  // it is set after, as an undo step of its own.
  const aligned = (col: number) => ({
    alignment: grid[0][col]?.attrs.alignment ?? null,
  });
  pasted.forEach((row, _, r) => {
    const at = top + r;
    if (at >= grid.length) {
      grid.push([]);
      rowTypes.push(bodyRow);
    }
    row.forEach((cell, __, c) => {
      const type = at === 0 ? header : body;
      grid[at][left + c] = type.create(
        grid[at][left + c]?.attrs ?? aligned(left + c),
        cell.content,
      );
      width = Math.max(width, left + c + 1);
    });
  });
  const rows = grid.map((cells, r) => {
    const type = r === 0 ? header : body;
    const full = Array.from(
      { length: width },
      (_, c) => cells[c] ?? type.createAndFill(aligned(c))!,
    );
    return rowTypes[r].create(null, full);
  });
  return table.type.create(table.attrs, rows);
}

/** The table at `pos` filled with `pasted` from row `top`, column `left`
 *  on (fillTable), the caret kept in that cell. */
export function fillTableAt(
  tr: Transaction,
  pos: number,
  top: number,
  left: number,
  pasted: Node,
): Transaction {
  const table = tr.doc.nodeAt(pos)!;
  const filled = fillTable(table, top, left, pasted);
  tr.replaceWith(pos, pos + table.nodeSize, filled);
  const cell = pos + 1 + TableMap.get(filled).positionAt(top, left, filled);
  return tr.setSelection(Selection.near(tr.doc.resolve(cell + 1)));
}

/**
 * List items pasted into a list item take that list's kind: into a to-do
 * list each is a to-do (one already ticked stays ticked), into a plain or
 * numbered list none is. Only the items that join the list, not lists
 * nested in them; pasted anywhere else they stay as they were.
 */
export function itemsLikeTarget(slice: Slice, $pos: ResolvedPos): Slice {
  let item: Node | null = null;
  for (let d = $pos.depth; d > 0 && !item; d--)
    if ($pos.node(d).type.name === "list_item") item = $pos.node(d);
  if (!item) return slice;
  const todo = item.attrs.checked != null;
  const listType = item.attrs.listType as string;
  let changed = false;
  const like = (node: Node): Node => {
    if (node.type.name !== "list_item") return node;
    const checked = todo ? (node.attrs.checked ?? false) : null;
    if (checked === node.attrs.checked && listType === node.attrs.listType)
      return node;
    changed = true;
    return node.type.create(
      { ...node.attrs, checked, listType },
      node.content,
      node.marks,
    );
  };
  const each = (fragment: Fragment, map: (node: Node) => Node) => {
    const nodes: Node[] = [];
    fragment.forEach((node) => nodes.push(map(node)));
    return Fragment.from(nodes);
  };
  const content = each(slice.content, (node) =>
    node.type.name === "bullet_list" || node.type.name === "ordered_list"
      ? node.copy(each(node.content, like))
      : like(node),
  );
  return changed ? new Slice(content, slice.openStart, slice.openEnd) : slice;
}
