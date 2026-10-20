import {
  Fragment,
  Slice,
  type Node,
  type ResolvedPos,
} from "@milkdown/kit/prose/model";

function inTableCell($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole as string | undefined;
    if (role === "cell" || role === "header_cell") return true;
  }
  return false;
}

/**
 * Lines pasted into a table cell, which holds one paragraph, joined into
 * one: their text with a space between, formatting kept. ProseMirror fits
 * several pasted lines to a cell as a row of cells, and those replaced the
 * cell at the caret and the ones after it. A copied table or its rows
 * still paste as cells; anything else pasted outside a cell is unchanged.
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
