import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/** The position range of `needle`'s single occurrence in a range's rendered
 *  plain text, or null if absent or repeated. The range must lie within one
 *  block: block separators aren't counted, and this doesn't check. */
export function locatePlainText(
  doc: ProseNode,
  from: number,
  to: number,
  needle: string,
): { from: number; to: number } | null {
  if (!needle) return null;
  const text = doc.textBetween(from, to, "\n", "\n");
  const start = text.indexOf(needle);
  if (start === -1 || text.indexOf(needle, start + 1) !== -1) return null;
  const end = start + needle.length;

  // Walk the range's actual text content, converting the plain-text offsets
  // [start, end) into real positions - textBetween's inverse.
  let consumed = 0;
  let posStart: number | null = null;
  let posEnd: number | null = null;
  doc.nodesBetween(from, to, (node, pos) => {
    // An inline leaf such as a hard break is text in textBetween, so it
    // counts here too.
    const leaf = node.isLeaf && !node.isText && node.isInline;
    if (!node.isText && !leaf) return true;
    const nodeFrom = Math.max(pos, from);
    const nodeTo = Math.min(pos + node.nodeSize, to);
    const len = leaf
      ? (node.type.spec.leafText?.(node) ?? "\n").length
      : nodeTo - nodeFrom;
    if (leaf) {
      // Nothing to point into: a match that takes any of it takes all.
      if (posStart === null && consumed + len > start) posStart = pos;
      if (posEnd === null && consumed + len >= end) posEnd = pos + 1;
      consumed += len;
      return true;
    }
    if (posStart === null && consumed + len > start) {
      posStart = nodeFrom + (start - consumed);
    }
    if (posEnd === null && consumed + len >= end) {
      posEnd = nodeFrom + (end - consumed);
    }
    consumed += len;
    return true;
  });
  if (posStart === null || posEnd === null) return null;
  return { from: posStart, to: posEnd };
}
