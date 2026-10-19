import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/**
 * Finds `needle`'s single occurrence within the RENDERED PLAIN TEXT of a
 * document range, returning its real ProseMirror position range - or null
 * when absent or ambiguous (more than one occurrence).
 *
 * This is the escape hatch from doc-markdown.ts's "a markdown offset inside
 * a block has no ProseMirror position" constraint: that constraint is about
 * MARKDOWN-SOURCE offsets, which don't map to positions because markdown
 * syntax density varies (a bold span is 4 extra characters in source but 0
 * in rendered text). Plain-text offsets have no such ambiguity - walking a
 * doc's actual text nodes to convert a plain-text offset back into a
 * position is a direct, unambiguous operation, the same one `doc.textBetween`
 * already does in the forward direction.
 *
 * SINGLE BLOCK ONLY: the position walk sums text-node lengths without
 * accounting for the block-separator characters `textBetween`'s search text
 * inserts between sibling block nodes, so a [from, to) spanning more than
 * one top-level block would search correctly but map positions wrong past
 * the first separator it crosses. Callers must confirm the range is within
 * one block first (usePendingEdits.ts does, via the serialized block list
 * it already has); this function does not check.
 */
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
    // A hard break (or another inline leaf) is text in textBetween - its
    // leafText, "\n" by default - and has to count here too: skipped, every
    // strike after one ended a character late (1.1).
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
