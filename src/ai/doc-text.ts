import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/**
 * Maps grammar checking's plain-text offsets to document positions, which
 * also count node boundaries. Plain text suits a within-sentence word swap;
 * whole-passage edits must work in markdown or they lose formatting.
 */

/** Document position of the `offset`-th character of `parent`'s textContent. */
export function textOffsetToDocPos(
  parent: ProseNode,
  contentStart: number,
  offset: number,
): number | null {
  if (offset === 0) return contentStart; // no text leaf needed (empty block, block start)
  let seen = 0;
  let result: number | null = null;
  parent.descendants((node, pos) => {
    if (result !== null) return false;
    if (!node.isText) return true;
    const len = node.text?.length ?? 0;
    if (offset <= seen + len) {
      result = contentStart + pos + (offset - seen);
      return false;
    }
    seen += len;
    return true;
  });
  // Text ended before `offset` but the content didn't (a trailing inline
  // non-text node): the content end is still "after all the text".
  if (result === null && offset === parent.textContent.length)
    return contentStart + parent.content.size;
  return result;
}

/**
 * UTF-16 offset of the `scalars`-th Unicode scalar value in `text`. Model
 * offsets count scalar values; JS indexing diverges after an astral char.
 */
export function scalarToUtf16Offset(text: string, scalars: number): number {
  let units = 0;
  let count = 0;
  for (const ch of text) {
    if (count === scalars) return units;
    units += ch.length;
    count++;
  }
  return units;
}
