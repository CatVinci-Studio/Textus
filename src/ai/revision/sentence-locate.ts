import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { trimBreaks, type SentenceHunk } from "./sentence-diff";

/**
 * Where each piece of a sentence diff (sentence-diff.ts) sits in the
 * document, so a rewrite can be shown - and decided - sentence by sentence
 * in the text itself, not only in the chat card.
 *
 * The hunks are MARKDOWN (the proposal's anchor and text), the document is
 * rendered text: each piece is turned into its plain text (`plainOf`, the
 * editor's own parser) and found in order in the range's text, the way
 * text-locate.ts finds a single needle. A piece that can't be rendered or
 * isn't next in line (markdown that changes structure, a list marker the
 * parse turns into a node) gives up on the whole proposal - the caller
 * then shows it as one struck block plus one insert, as before.
 *
 * `lead` is the markdown in the range before the first hunk. An anchor that
 * spans paragraphs resolves to their whole blocks, not to the quoted text
 * (there is no tighter range across blocks), so the first block may start
 * with words the rewrite doesn't touch. They are skipped as one piece and
 * never searched past: a sentence repeated before the anchor would
 * otherwise be taken for it.
 *
 * Returns one range per hunk, `same` and `change` alike, in order; an empty
 * `before` (a pure insertion) gets an empty range where it would go.
 */
/**
 * The range's text, and each character's document position - unlike
 * textBetween, nothing between text nodes (a hard break, an inline atom, a
 * block boundary) adds characters, so a piece never has to match across a
 * separator.
 */
function textPositions(
  doc: ProseNode,
  from: number,
  to: number,
): { text: string; positions: number[] } {
  const positions: number[] = [];
  let text = "";
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return true;
    const a = Math.max(pos, from);
    const b = Math.min(pos + node.nodeSize, to);
    for (let p = a; p < b; p++) positions.push(p);
    text += node.text.slice(a - pos, b - pos);
    return true;
  });
  return { text, positions };
}

/**
 * Where each of `needles` (plain text, line breaks left out) stands in
 * [from, to), in order - for the text an Accept just wrote. One not found
 * is skipped.
 */
export function findInOrder(
  doc: ProseNode,
  from: number,
  to: number,
  needles: string[],
): { from: number; to: number }[] {
  const { text, positions } = textPositions(doc, from, to);
  const out: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const needle of needles) {
    const index = needle ? text.indexOf(needle, cursor) : -1;
    if (index === -1) continue;
    out.push({
      from: positions[index],
      to: positions[index + needle.length - 1] + 1,
    });
    cursor = index + needle.length;
  }
  return out;
}

export function locateHunks(
  doc: ProseNode,
  from: number,
  to: number,
  hunks: SentenceHunk[],
  plainOf: (markdown: string) => string | null,
  lead = "",
): { from: number; to: number }[] | null {
  const { text, positions } = textPositions(doc, from, to);
  if (positions.length === 0) return null;
  const at = (i: number) =>
    i < positions.length ? positions[i] : positions[positions.length - 1] + 1;

  // A piece's text as `text` has it: a hard break inside it is a "\n" in
  // the parse and nothing here.
  const plainPiece = (markdown: string) =>
    plainOf(trimBreaks(markdown))?.replace(/\n/g, "").trim();
  const out: { from: number; to: number }[] = [];
  let cursor = 0;
  if (lead.trim()) {
    const plain = plainPiece(lead);
    const index = plain ? text.indexOf(plain) : -1;
    if (!plain || index === -1 || text.slice(0, index).trim()) return null;
    cursor = index + plain.length;
  }
  // An unchanged piece whose text can't be matched as it stands - a table
  // or a code block, whose Markdown (`| --- |`, fences) the text doesn't
  // have: it is whatever lies before the next piece, found once that one
  // is (a run of them - a table's rows - the first taking it all). Matched
  // exactly, it would have made a whole-text rewrite of a document with a
  // table fall back to one block and one card.
  let unplaced = -1;
  const place = (index: number) => {
    if (unplaced < 0) return;
    for (let k = unplaced; k < out.length; k++) {
      out[k] =
        k === unplaced
          ? { from: at(cursor), to: at(index) }
          : { from: at(index), to: at(index) };
    }
    unplaced = -1;
  };
  for (const hunk of hunks) {
    const markdown = hunk.kind === "same" ? hunk.text : hunk.before;
    if (!markdown.trim()) {
      const p = at(cursor);
      out.push({ from: p, to: p });
      continue;
    }
    const plain = plainPiece(markdown);
    const index = plain ? text.indexOf(plain, cursor) : -1;
    // Found, and nothing but whitespace skipped on the way - text in
    // between would belong to no piece, unless an unchanged one before it
    // is still to be placed.
    const adjacent = index !== -1 && !text.slice(cursor, index).trim();
    if (hunk.kind === "same" && !adjacent) {
      if (unplaced < 0) unplaced = out.length;
      out.push({ from: at(cursor), to: at(cursor) });
      continue;
    }
    if (!plain || index === -1 || (!adjacent && unplaced < 0)) return null;
    if (unplaced >= 0) {
      place(index);
      cursor = index;
    }
    out.push({
      from: positions[index],
      to: positions[index + plain.length - 1] + 1,
    });
    cursor = index + plain.length;
  }
  place(text.length);
  return out;
}
