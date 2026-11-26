import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { textWithPositions } from "../../editor/text-positions";
import { wholeBlockKind } from "./markdown-forms";
import { trimBreaks, type SentenceHunk } from "./sentence-diff";
import { linkHref, parseLink } from "../../editor/markdown/link-syntax";

/** `[url](url)`: a bare URL right against text is written so (link-source's
 *  asWritten), while the editor holds the URL alone as the link's text. */
const SELF_LINK = /\[([^[\]\s]+)\]\(([^()\s]+)\)/g;

/** Where `needle`, a piece's text as parsed, stands in `text` from `from`:
 *  as it is, or with each self-link as the bare URL the document shows. */
function indexOfShown(
  text: string,
  needle: string,
  from = 0,
): { index: number; length: number } | null {
  const index = text.indexOf(needle, from);
  if (index !== -1) return { index, length: needle.length };
  const bare = needle.replace(SELF_LINK, (link, label: string, dest: string) =>
    parseLink(label)?.kind === "bare" && linkHref(label) === dest
      ? label
      : link,
  );
  if (bare === needle) return null;
  const at = text.indexOf(bare, from);
  return at === -1 ? null : { index: at, length: bare.length };
}

/** Where each of `needles` stands in [from, to), in order; one not found is
 *  skipped. */
export function findInOrder(
  doc: ProseNode,
  from: number,
  to: number,
  needles: string[],
): { from: number; to: number }[] {
  const { text, positions } = textWithPositions(doc, from, to);
  const out: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const needle of needles) {
    const found = needle ? indexOfShown(text, needle, cursor) : null;
    if (!found) continue;
    const { index, length } = found;
    out.push({
      from: positions[index],
      to: positions[index + length - 1] + 1,
    });
    cursor = index + length;
  }
  return out;
}

/** Where each sentence-diff hunk sits in the document, one range per hunk in
 *  order; null when a piece isn't next in line. `lead` is the untouched text
 *  before the first hunk, skipped so a repeat before the anchor isn't taken. */
export function locateHunks(
  doc: ProseNode,
  from: number,
  to: number,
  hunks: SentenceHunk[],
  plainOf: (markdown: string) => string | null,
  lead = "",
): LocatedHunk[] | null {
  const { text, positions } = textWithPositions(doc, from, to);
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
    const found = plain ? indexOfShown(text, plain) : null;
    if (!found || text.slice(0, found.index).trim()) return null;
    cursor = found.index + found.length;
    pos = at(cursor - 1) + 1;
  }
  // An unchanged piece that can't be matched, or has no text, is whatever
  // lies between its neighbours.
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
      // A whole block added goes between blocks: after the one the pieces
      // so far end in.
      if (hunk.kind === "change" && wholeBlockKind(hunk.after) !== null) {
        const p = blockBoundaryAfter(doc, pos);
        out.push({ from: p, to: p, block: true });
        continue;
      }
      const p = at(cursor);
      out.push({ from: p, to: p });
      continue;
    }
    // A block changed whole is the next such block of the document: its
    // Markdown isn't the text it shows.
    const kind = wholeBlockKind(markdown);
    if (kind !== null) {
      // The next block node of its kind; the next of any, when the editor
      // reads it as a kind of its own (frontmatter, an embed).
      const ahead = wholes.filter((n) => n.from >= pos);
      const node = ahead.find((n) => fits(kind, n.kind)) ?? ahead[0];
      if (!node) return null;
      place(node.from);
      out.push({ ...node, block: true });
      pos = node.to;
      cursor = indexAt(node.to);
      continue;
    }
    const plain = plainPiece(markdown);
    const shown = plain ? indexOfShown(text, plain, cursor) : null;
    const index = shown ? shown.index : -1;
    // Found with only whitespace skipped, or text between would belong to no
    // piece, unless an unchanged one before it is still to be placed.
    const adjacent = index !== -1 && !text.slice(cursor, index).trim();
    if (!plain || (hunk.kind === "same" && !adjacent)) {
      if (unplaced < 0) unplaced = out.length;
      out.push({ from: pos, to: pos });
      continue;
    }
    if (!shown || (!adjacent && unplaced < 0)) return null;
    place(positions[index]);
    const { length } = shown;
    const found = {
      from: positions[index],
      to: positions[index + length - 1] + 1,
    };
    out.push(found);
    cursor = index + length;
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

/** The blocks in [from, to) a whole-block hunk can be: non-prose nodes and
 *  picture-only paragraphs, in order, outermost first. */
function wholeNodes(doc: ProseNode, from: number, to: number): WholeNode[] {
  const out: WholeNode[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isBlock || pos < from || pos + node.nodeSize > to) return true;
    const kind = nodeKind(node);
    if (kind === null) return true;
    out.push({ from: pos, to: pos + node.nodeSize, kind });
    return false;
  });
  return out;
}

interface WholeNode {
  from: number;
  to: number;
  /** As wholeBlockKind names it, or the node's own type for one it
   *  doesn't know. */
  kind: string;
}

/** What `node` is as a whole block; null for prose. A paragraph with no text
 *  of its own is a picture, an HTML block or a link definition. */
function nodeKind(node: ProseNode): string | null {
  const name = node.type.name;
  const kinds: Record<string, string> = {
    table: "table",
    code_block: "code",
    math_block: "math",
    footnote_definition: "footnote",
    hr: "rule",
  };
  if (kinds[name]) return kinds[name];
  if (!PROSE.has(name)) return name;
  if (name !== "paragraph" || node.childCount === 0) return null;
  const children = new Set<string>();
  let ownText = false;
  node.forEach((child) => {
    ownText ||= child.isText;
    children.add(child.type.name);
  });
  if (ownText) return null;
  if (children.has("link_definition")) return "definition";
  if (children.has("html")) return "html";
  return "picture";
}

/** Whether a node read as `node` can be a block written as `markdown`: an
 *  `<img>` is a picture written as HTML. */
function fits(markdown: string, node: string): boolean {
  return node === markdown || (markdown === "picture" && node === "html");
}

/** The position after the textblock `pos` is in (or `pos`, between
 *  blocks already). */
function blockBoundaryAfter(doc: ProseNode, pos: number): number {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--)
    if ($pos.node(d).isTextblock) return $pos.after(d);
  return pos;
}
