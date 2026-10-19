import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { SentenceHunk } from "./sentence-diff";

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
export function locateHunks(
  doc: ProseNode,
  from: number,
  to: number,
  hunks: SentenceHunk[],
  plainOf: (markdown: string) => string | null,
  lead = "",
): { from: number; to: number }[] | null {
  // The range's text, and each character's document position - unlike
  // textBetween, nothing between text nodes (a hard break, an inline atom)
  // adds characters, so a piece never has to match across a separator.
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
  if (positions.length === 0) return null;
  const at = (i: number) =>
    i < positions.length ? positions[i] : positions[positions.length - 1] + 1;

  const out: { from: number; to: number }[] = [];
  let cursor = 0;
  if (lead.trim()) {
    const plain = plainOf(lead.trim())?.trim();
    const index = plain ? text.indexOf(plain) : -1;
    if (!plain || index === -1 || text.slice(0, index).trim()) return null;
    cursor = index + plain.length;
  }
  for (const hunk of hunks) {
    const markdown = hunk.kind === "same" ? hunk.text : hunk.before;
    if (!markdown.trim()) {
      const p = at(cursor);
      out.push({ from: p, to: p });
      continue;
    }
    const plain = plainOf(markdown.trim())?.trim();
    if (!plain) return null;
    const index = text.indexOf(plain, cursor);
    // Found, and nothing but whitespace skipped on the way - text in
    // between would belong to no piece.
    if (index === -1 || text.slice(cursor, index).trim()) return null;
    out.push({
      from: positions[index],
      to: positions[index + plain.length - 1] + 1,
    });
    cursor = index + plain.length;
  }
  return out;
}
