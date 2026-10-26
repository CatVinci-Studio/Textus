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

/**
 * The document range of the single occurrence of `snippet` in the plain-text
 * view the model was shown (textblocks joined with "\n\n"). Null when absent
 * or ambiguous.
 */
export function findUniqueTextRange(
  doc: ProseNode,
  snippet: string,
): { from: number; to: number } | null {
  if (!snippet) return null;
  return snippet.includes("\n\n")
    ? findAcrossBlocks(doc, snippet.split("\n\n"))
    : findWithinBlock(doc, snippet);
}

function findWithinBlock(
  doc: ProseNode,
  snippet: string,
): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null;
  let count = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    let idx = text.indexOf(snippet);
    while (idx !== -1) {
      count++;
      if (count === 1) {
        const from = textOffsetToDocPos(node, pos + 1, idx);
        const to = textOffsetToDocPos(node, pos + 1, idx + snippet.length);
        if (from !== null && to !== null) hit = { from, to };
      }
      idx = text.indexOf(snippet, idx + 1);
    }
    return false; // textblock children are inline - nothing more to visit
  });
  return count === 1 ? hit : null;
}

/**
 * Multi-block match of the snippet's "\n\n"-separated `parts`: the first ends
 * a block, middle ones are whole blocks, the last starts the final block.
 */
function findAcrossBlocks(
  doc: ProseNode,
  parts: string[],
): { from: number; to: number } | null {
  const blocks: { node: ProseNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      blocks.push({ node, pos });
      return false;
    }
    return true;
  });

  let hit: { from: number; to: number } | null = null;
  let count = 0;
  const last = parts.length - 1;
  for (let i = 0; i + last < blocks.length; i++) {
    const firstText = blocks[i].node.textContent;
    if (!firstText.endsWith(parts[0])) continue;
    let ok = true;
    for (let k = 1; k < last; k++) {
      if (blocks[i + k].node.textContent !== parts[k]) {
        ok = false;
        break;
      }
    }
    if (!ok || !blocks[i + last].node.textContent.startsWith(parts[last]))
      continue;
    count++;
    if (count === 1) {
      const from = textOffsetToDocPos(
        blocks[i].node,
        blocks[i].pos + 1,
        firstText.length - parts[0].length,
      );
      const to = textOffsetToDocPos(
        blocks[i + last].node,
        blocks[i + last].pos + 1,
        parts[last].length,
      );
      if (from !== null && to !== null) hit = { from, to };
    }
  }
  return count === 1 ? hit : null;
}
