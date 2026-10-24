import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { blockKind } from "../doc-blocks";
import { paragraphCount } from "./sentence-diff";

/**
 * A change of several whole paragraphs (short ones taken together, or
 * paragraphs joined or split) as a change of blocks: the paragraphs it
 * covers struck whole, the new ones drawn as the paragraphs they will be
 * after them. Drawn in the last one's run of text, they stood as one tall
 * paragraph that moved everything below once taken. Null when the change
 * is inside a paragraph, or covers anything but top-level paragraphs.
 * The same while a rewrite streams in (stream-widgets' streamChanges) as
 * once it is done, so nothing moves when it settles.
 */
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
    // A picture is a paragraph too (doc-blocks.ts's blockKind): taken
    // into the block, its redo proposal lost the node it replaces once the
    // rewrite was accepted.
    if (blockKind(node) !== "paragraph") plain = false;
    parts.push({ from: pos, to: pos + node.nodeSize });
    return false;
  });
  return plain ? { from, to, block: true, at: to, parts } : null;
}
