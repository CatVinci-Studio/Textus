import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { wholeBlockKind } from "./markdown-forms";
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
 * A block changed whole (markdown-forms.ts's wholeBlockKind: a picture, a
 * table, a code block) isn't text to find: it is the next such block node,
 * found by the node it is (wholeNodes).
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
): LocatedHunk[] | null {
  const { text, positions } = textPositions(doc, from, to);
  if (positions.length === 0) return null;
  const at = (i: number) =>
    i < positions.length ? positions[i] : positions[positions.length - 1] + 1;
  // The first character of text at or after document position `p`.
  const indexAt = (p: number) => {
    const i = positions.findIndex((q) => q >= p);
    return i === -1 ? text.length : i;
  };
  const wholes = wholeNodes(doc, from, to);

  // A piece's text as `text` has it: a hard break inside it is a "\n" in
  // the parse and nothing here.
  const plainPiece = (markdown: string) =>
    plainOf(trimBreaks(markdown))?.replace(/\n/g, "").trim();
  const out: LocatedHunk[] = [];
  // Where the pieces found so far end: in the text, and in the document.
  let cursor = 0;
  let pos = from;
  if (lead.trim()) {
    const plain = plainPiece(lead);
    const index = plain ? text.indexOf(plain) : -1;
    if (!plain || index === -1 || text.slice(0, index).trim()) return null;
    cursor = index + plain.length;
    pos = at(cursor - 1) + 1;
  }
  // An unchanged piece whose text can't be matched as it stands, or a
  // piece with no text (a lone footnote mark): it is whatever lies between
  // the piece before it and the next one found (a run of them, the first
  // taking it all).
  let unplaced = -1;
  const place = (end: number) => {
    if (unplaced < 0) return;
    for (let k = unplaced; k < out.length; k++)
      out[k] = k === unplaced ? { from: pos, to: end } : { from: end, to: end };
    unplaced = -1;
  };
  for (const hunk of hunks) {
    const markdown = hunk.kind === "same" ? hunk.text : hunk.before;
    if (!markdown.trim()) {
      const p = at(cursor);
      out.push({ from: p, to: p });
      continue;
    }
    // A block changed whole (wholeBlockKind: a picture, a table…) is the
    // next such block of the document: its Markdown isn't the text it
    // shows, and it may have none.
    if (wholeBlockKind(markdown) !== null) {
      const node = wholes.find((n) => n.from >= pos);
      if (!node) return null;
      place(node.from);
      out.push({ ...node, block: true });
      pos = node.to;
      cursor = indexAt(node.to);
      continue;
    }
    const plain = plainPiece(markdown);
    const index = plain ? text.indexOf(plain, cursor) : -1;
    // Found, and nothing but whitespace skipped on the way - text in
    // between would belong to no piece, unless an unchanged one before it
    // is still to be placed.
    const adjacent = index !== -1 && !text.slice(cursor, index).trim();
    if (!plain || (hunk.kind === "same" && !adjacent)) {
      if (unplaced < 0) unplaced = out.length;
      out.push({ from: pos, to: pos });
      continue;
    }
    if (index === -1 || (!adjacent && unplaced < 0)) return null;
    place(positions[index]);
    const found = {
      from: positions[index],
      to: positions[index + plain.length - 1] + 1,
    };
    out.push(found);
    cursor = index + plain.length;
    pos = found.to;
  }
  place(to);
  return out;
}

/** A hunk's place in the document: its text, or (`block`) the block node
 *  a whole-block hunk is. */
export interface LocatedHunk {
  from: number;
  to: number;
  block?: true;
}

/** The blocks of prose - located by their text, sentence by sentence. A
 *  paragraph with no text is a picture's. */
const PROSE = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bullet_list",
  "ordered_list",
  "list_item",
]);

/** The blocks in [from, to) a whole-block hunk can be - each node that
 *  isn't prose (a table, a code block, a footnote's definition) or is a
 *  paragraph of nothing but a picture - in order, outermost first. */
function wholeNodes(
  doc: ProseNode,
  from: number,
  to: number,
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isBlock || pos < from || pos + node.nodeSize > to) return true;
    // A paragraph of a picture or of raw HTML (an HTML block parses into
    // `paragraph > html`) has no text of its own.
    let ownText = false;
    node.forEach((child) => (ownText ||= child.isText));
    const whole = PROSE.has(node.type.name)
      ? node.type.name === "paragraph" && node.childCount > 0 && !ownText
      : true;
    if (!whole) return true;
    out.push({ from: pos, to: pos + node.nodeSize });
    return false;
  });
  return out;
}
