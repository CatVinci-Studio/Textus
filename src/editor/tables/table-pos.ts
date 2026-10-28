import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";

/** A table's cell, header or body: by its table role, whatever the node
 *  is named. */
export function isTableCell(node: Node): boolean {
  const role = node.type.spec.tableRole as string | undefined;
  return role === "cell" || role === "header_cell";
}

/** Whether `$pos` is inside a table's cell. */
export function inTableCell($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--)
    if (isTableCell($pos.node(d))) return true;
  return false;
}
