import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { blockKind } from "../doc-blocks";
import { paragraphCount } from "./sentence-diff";

/** A change of several whole paragraphs drawn as blocks, the new ones as the
 *  paragraphs they will be. Null inside one paragraph or for other blocks. */
export function wholeParagraphs(
  doc: ProseNode,
  range: { from: number; to: number },
  before: string,
  after: string,
): {
  from: number;
  to: number;
  block: true;
  at: number;
  parts: { from: number; to: number }[];
} | null {
  if (paragraphCount(before) < 2 && paragraphCount(after) < 2) return null;
  const start = doc.resolve(range.from);
  const end = doc.resolve(range.to);
  if (start.depth !== 1 || end.depth !== 1) return null;
  if (start.parentOffset !== 0 || end.parentOffset !== end.parent.content.size)
    return null;
  const from = start.before();
  const to = end.after();
  let plain = true;
  const parts: { from: number; to: number }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    // A picture is a paragraph too, but taken in, its redo proposal would
    // lose the node it replaces.
    if (blockKind(node) !== "paragraph") plain = false;
    parts.push({ from: pos, to: pos + node.nodeSize });
    return false;
  });
  return plain ? { from, to, block: true, at: to, parts } : null;
}
