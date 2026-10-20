import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { isCjk } from "../utils/cjk";
import { serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { Selection, type EditorState } from "@milkdown/kit/prose/state";
import { escapeRegExp } from "../utils/regexp";
import type { EditAction } from "./types";

/**
 * The document as MARKDOWN SOURCE, which is the representation every AI edit
 * path works in.
 *
 * The older plain-text view (doc.textBetween) was lossy in a way that
 * silently destroyed formatting: the model was shown "这是 重要 内容" for a
 * document that actually reads "这是 **重要** 内容", so it had no way to know
 * a span was bold, a line was a heading, or a paragraph was a list item -
 * and its reply was then parsed BACK as markdown. Three different
 * representations, none of them equal.
 *
 * Everything here keeps a single one: what the model reads, what an anchor is
 * matched against, and what gets parsed on accept are all the same markdown
 * string. Block boundaries carry the ProseMirror positions alongside, so a
 * markdown-space match still resolves to a real document range without
 * needing a markdown-offset -> ProseMirror-position sourcemap (Milkdown
 * offers none, and maintaining one would be its own moving part).
 */

/** What documentMarkdown joins blocks with - one blank line, as markdown. */
const BLOCK_SEPARATOR = "\n\n";

/** One top-level block, in both coordinate systems at once. */
export interface MarkdownBlock {
  /** ProseMirror position immediately before the block node. */
  from: number;
  /** ProseMirror position immediately after the block node. */
  to: number;
  /** The block serialized to markdown, without trailing blank lines. */
  markdown: string;
  /** Where this block's markdown starts inside documentMarkdown()'s output. */
  offset: number;
}

/** The current selection, in the three forms every AI surface needs it in.
 *
 * Shared because there are two of those surfaces and they must agree on what
 * counts as "the selection": Quick Ask captures it once when it opens
 * (useInlineChat) and the detached window re-reads it as the user works
 * (chat/live-context). Two copies of these four expressions would drift the
 * first time either grew a special case. */
export interface SelectionSnapshot {
  /** Plain text - display only (the composer's "{n} chars" chip). */
  selectedText: string | null;
  /** Markdown - what the model is actually shown, and what a
   *  replace_selection proposal's staleness check compares against. */
  selectionMarkdown: string | null;
  /** ProseMirror bounds, or null when the selection is empty. */
  range: { from: number; to: number } | null;
}

export function readSelection(ctx: Ctx, state: EditorState): SelectionSnapshot {
  const { doc, selection } = state;
  if (selection.empty) {
    return { selectedText: null, selectionMarkdown: null, range: null };
  }
  const range = textRange(doc, selection.from, selection.to);
  return {
    selectedText: doc.textBetween(range.from, range.to, " "),
    selectionMarkdown: serializeRange(ctx, doc, range.from, range.to),
    range,
  };
}

/**
 * A selection's bounds without the block edges it only grazes. A triple
 * click selects a paragraph up to the START of the next one, so the range
 * crossed a block boundary it didn't mean: the model's rewrite replaced
 * that boundary too, and accepting it joined the paragraph to the next.
 * Each end steps back over empty block edges into the text it selected.
 */
export function textRange(
  doc: ProseNode,
  from: number,
  to: number,
): { from: number; to: number } {
  let end = to;
  for (;;) {
    const $end = doc.resolve(end);
    if (end <= from || !$end.parent.isTextblock || $end.parentOffset > 0) break;
    const prev = textblockEdge(doc, $end.before(), -1);
    if (prev === null || prev < from) break;
    end = prev;
  }
  let start = from;
  for (;;) {
    const $start = doc.resolve(start);
    if (
      start >= end ||
      !$start.parent.isTextblock ||
      $start.parentOffset < $start.parent.content.size
    )
      break;
    const next = textblockEdge(doc, $start.after(), 1);
    if (next === null || next > end) break;
    start = next;
  }
  return start < end ? { from: start, to: end } : { from, to };
}

/** The end (dir -1) of the textblock before `pos`, or the start (dir 1)
 *  of the one after it. */
function textblockEdge(doc: ProseNode, pos: number, dir: -1 | 1) {
  return Selection.findFrom(doc.resolve(pos), dir, true)?.from ?? null;
}

/** The innermost heading above `pos` - the section being worked in. */
export function headingAt(doc: ProseNode, pos: number): string | null {
  return headingTrail(doc, pos).path.at(-1)?.text ?? null;
}

/** The top-level headings before `pos`: the first one (the document's
 *  title) and the path of nested sections down to `pos`. */
export function headingTrail(
  doc: ProseNode,
  pos: number,
): { title: string | null; path: { level: number; text: string }[] } {
  let title: string | null = null;
  const path: { level: number; text: string }[] = [];
  doc.forEach((node, offset) => {
    if (offset >= pos || node.type.name !== "heading") return;
    const level = Number(node.attrs.level) || 1;
    const text = node.textContent.trim();
    if (!text) return;
    title ??= text;
    while (path.length && path[path.length - 1].level >= level) path.pop();
    path.push({ level, text });
  });
  return { title, path };
}

/** The caret and the plain text around it, when nothing is selected - for
 *  the <cursor> block a request carries (user-message.ts's cursorBlock). */
export function caretContext(
  state: EditorState,
  span = 160,
): { pos: number; before: string; after: string } | null {
  const { selection, doc } = state;
  if (!selection.empty) return null;
  const pos = selection.from;
  return {
    pos,
    before: doc
      .textBetween(Math.max(0, pos - span * 4), pos, "\n")
      .slice(-span),
    after: doc
      .textBetween(pos, Math.min(doc.content.size, pos + span * 4), "\n")
      .slice(0, span),
  };
}

/** Markdown source of a ProseMirror range - the selection, a block, a slice. */
export function serializeRange(
  ctx: Ctx,
  doc: ProseNode,
  from: number,
  to: number,
): string {
  return ctx.get(serializerCtx)(doc.cut(from, to)).trimEnd();
}

/**
 * Every top-level block with its markdown and its ProseMirror range. Blocks
 * are serialized one at a time (rather than slicing a whole-document string)
 * so each one's markdown is anchored to an exact node range - that pairing is
 * what lets a markdown-space match land back on a real document position.
 */
export function serializeBlocks(ctx: Ctx, doc: ProseNode): MarkdownBlock[] {
  const serializer = ctx.get(serializerCtx);
  const blocks: MarkdownBlock[] = [];
  let offset = 0;
  doc.forEach((node, pos) => {
    const markdown = serializer(doc.cut(pos, pos + node.nodeSize)).trimEnd();
    blocks.push({ from: pos, to: pos + node.nodeSize, markdown, offset });
    offset += markdown.length + BLOCK_SEPARATOR.length;
  });
  return blocks;
}

/** The whole document as one markdown string - what the model is shown. */
export function documentMarkdown(blocks: MarkdownBlock[]): string {
  return blocks.map((block) => block.markdown).join(BLOCK_SEPARATOR);
}

/**
 * `documentMarkdown(serializeBlocks(...))`, cached against the ProseMirror
 * doc it came from.
 *
 * ProseMirror documents are immutable, so `doc === lastDoc` is an O(1) exact
 * test for "nothing to re-serialize" - and during the gesture the detached
 * chat's live context exists for, drag-selecting a passage, the document does
 * not change at all while the selection changes on every mousemove. Without
 * the cache each of those re-ran the serializer once per top-level block.
 * Quick Ask's open-time snapshot reads through the same cache, so opening the
 * bar right after a push reuses the identical string. A WeakMap so a
 * superseded doc is collectable the moment nothing else holds it.
 */
const documentCache = new WeakMap<ProseNode, string>();

export function cachedDocumentMarkdown(ctx: Ctx, doc: ProseNode): string {
  const cached = documentCache.get(doc);
  if (cached !== undefined) return cached;
  const markdown = documentMarkdown(serializeBlocks(ctx, doc));
  documentCache.set(doc, markdown);
  return markdown;
}

/**
 * A resolved anchor: the ProseMirror range of the WHOLE blocks the snippet
 * touches, plus the markdown on either side of the snippet within them.
 *
 * The range is snapped outward to block boundaries deliberately. A markdown
 * offset inside a block can't be converted to a ProseMirror position, but a
 * block boundary can - so the edit is composed as text (prefix + new middle +
 * suffix) and applied by re-parsing those whole blocks. Sub-block precision
 * survives in the composed markdown; only the range that gets re-parsed is
 * coarse.
 */
export interface MarkdownMatch {
  from: number;
  to: number;
  /** Markdown between the first touched block's start and the snippet. */
  prefix: string;
  /** Markdown between the snippet's end and the last touched block's end. */
  suffix: string;
  /** Current markdown of the touched blocks - `prefix + snippet + suffix`. */
  markdown: string;
}

function blockIndexAt(blocks: MarkdownBlock[], offset: number): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (offset >= blocks[i].offset) return i;
  }
  return 0;
}

/** Byte offset of `needle`'s single occurrence in `doc`, null when absent
 *  or repeated - an ambiguous match can't be trusted to be the one meant. */
function uniqueIndexOf(doc: string, needle: string): number | null {
  const first = doc.indexOf(needle);
  if (first === -1 || doc.indexOf(needle, first + 1) !== -1) return null;
  return first;
}

/**
 * Whitespace-tolerant retry for a snippet with NO verbatim occurrence at
 * all: models routinely fold the blank line between blocks into a single
 * newline (or a space) when quoting. Word-ish runs must still match
 * verbatim and the whole thing must still occur exactly once, so this
 * can't land an edit anywhere an exact quote couldn't have.
 */
function flexibleRange(
  doc: string,
  snippet: string,
): { start: number; end: number } | null {
  const tokens = snippet.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null; // single token: flexible == exact
  const pattern = new RegExp(tokens.map(escapeRegExp).join("\\s+"), "g");
  const first = pattern.exec(doc);
  if (!first || pattern.exec(doc)) return null;
  return { start: first.index, end: first.index + first[0].length };
}

/** One character's matching form - mirrors tools.rs's normalize_char:
 *  typographic quotes, dash variants, full-width ASCII and non-breaking
 *  spaces fold to plain ASCII. One char in, one char out (all BMP), so an
 *  index into the normalized text is an index into the original. */
function normalizeForMatch(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x2018 || c === 0x2019 || c === 0x201a || c === 0x2032)
      out += "'";
    else if (c === 0x201c || c === 0x201d || c === 0x201e || c === 0x2033)
      out += '"';
    else if ((c >= 0x2010 && c <= 0x2015) || c === 0x2212) out += "-";
    else if (c === 0xa0 || c === 0x2007 || c === 0x202f || c === 0x3000)
      out += " ";
    else if (c >= 0xff01 && c <= 0xff5e)
      out += String.fromCodePoint(c - 0xfee0);
    else out += ch;
  }
  return out;
}

/**
 * Locates `snippet` in the document's markdown. Null when it's absent or
 * occurs more than once - the same "must be quoted verbatim and occur exactly
 * once" contract the backend states in AGENT_TOOL_INSTRUCTIONS, only now
 * evaluated against the markdown the model was actually shown.
 *
 * Two escape hatches keep honest proposals from dying on that contract
 * (both mirrored in the backend's propose_edit validation, tools.rs):
 * `context` - a longer verbatim quote containing the snippet, itself
 * unique - pins down WHICH occurrence a repeated snippet means, and a
 * whitespace-tolerant retry catches quotes whose only defect is a folded
 * blank line. Anything still unresolved stays null; there is deliberately
 * no fuzzier fallback than whitespace.
 */
export function findMarkdownMatch(
  blocks: MarkdownBlock[],
  snippet: string,
  context?: string,
): MarkdownMatch | null {
  if (!snippet || blocks.length === 0) return null;
  const doc = documentMarkdown(blocks);

  let range: { start: number; end: number } | null = null;
  const exact = uniqueIndexOf(doc, snippet);
  if (exact !== null) range = { start: exact, end: exact + snippet.length };
  if (!range && context && context.length > snippet.length) {
    const inner = context.indexOf(snippet);
    const contextStart = inner === -1 ? null : uniqueIndexOf(doc, context);
    if (contextStart !== null) {
      const start = contextStart + inner;
      range = { start, end: start + snippet.length };
    }
  }
  // The same fallback order as tools.rs's anchor_match_count: typography
  // first, then (also) folded whitespace - but only for a snippet with no
  // verbatim occurrence at all.
  if (!range && doc.indexOf(snippet) === -1) {
    const normDoc = normalizeForMatch(doc);
    const normSnippet = normalizeForMatch(snippet);
    const normalized = uniqueIndexOf(normDoc, normSnippet);
    if (normalized !== null)
      range = { start: normalized, end: normalized + normSnippet.length };
    else if (normDoc.indexOf(normSnippet) === -1)
      range = flexibleRange(normDoc, normSnippet);
  }
  if (!range) return null;
  const { start, end } = range;

  const startIdx = blockIndexAt(blocks, start);
  // `end` is exclusive, so probe the last character the snippet covers.
  const endIdx = Math.max(startIdx, blockIndexAt(blocks, end - 1));
  const first = blocks[startIdx];
  const last = blocks[endIdx];
  const spanStart = first.offset;
  const spanEnd = last.offset + last.markdown.length;

  return {
    from: first.from,
    to: last.to,
    prefix: doc.slice(spanStart, Math.max(spanStart, start)),
    suffix: doc.slice(Math.min(spanEnd, end), spanEnd),
    markdown: doc.slice(spanStart, spanEnd),
  };
}

/** Whether `text` is block content of its own - several paragraphs, a
 *  heading/list/quote/fence/table line, or an image alone (a figure, such
 *  as generate_image proposes) - rather than words for a sentence. */
function isBlockText(text: string): boolean {
  const trimmed = text.trim();
  return (
    /\n\s*\n/.test(trimmed) ||
    /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\|)/.test(trimmed) ||
    /^!\[[^\]\n]*\]\([^)\n]*\)$/.test(trimmed)
  );
}

/** Joins two runs of inline text, adding the one space Latin script needs
 *  between words when neither side brought it - "the study" + "in 2024" -
 *  and nothing between CJK characters, before punctuation or before a
 *  footnote reference, which attaches to its word ("snapshot" + "[^2]";
 *  the live eval saw "snapshot [^2]" next to the author's "document[^1]"). */
export function joinInline(left: string, right: string): string {
  const a = left.slice(-1);
  const b = right.charAt(0);
  if (!a || !b || /\s/.test(a) || /\s/.test(b)) return left + right;
  if (isCjk(a) || isCjk(b) || /[.,;:!?)\]}]/.test(b)) return left + right;
  if (right.startsWith("[^")) return left + right;
  return `${left} ${right}`;
}

const TABLE_ROW = /^\s*\|/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;

/** Whether two lines are rows of one table or items of one list - where a
 *  new line joins with a single newline. A blank line would end the table
 *  (the new row turns into a stray paragraph of pipes), and trimming a
 *  nested item's indent would pull it out of its parent. */
function sameLineKind(a: string, b: string): boolean {
  return (
    (TABLE_ROW.test(a) && TABLE_ROW.test(b)) ||
    (LIST_ITEM.test(a) && LIST_ITEM.test(b))
  );
}

/** Whether the match covers its blocks entirely - nothing before or after
 *  it inside them. */
function wholeBlock(match: MarkdownMatch): boolean {
  return match.prefix.trim() === "" && match.suffix.trim() === "";
}

/** Whether the matched markdown is one plain paragraph - not several
 *  blocks, and not a heading, list, table, quote, fence, math or HTML
 *  block, footnote or rule. */
function isParagraph(markdown: string): boolean {
  return !isBlockText(markdown) && !/^\s*(<|\$\$|\[\^|---)/.test(markdown);
}

/** Whether text inserted on the `edge` side of the match (its prefix or
 *  suffix) starts a block of its own: it is block content, the match is
 *  the whole block, or the match reaches the edge of a block no sentence
 *  carries on past. Only a paragraph goes on after its last sentence - a
 *  sentence glued onto a table's row turns into a cell (or, before the
 *  header row, dissolves the table), and onto a heading or the last list
 *  item it becomes part of them. */
function startsBlock(
  match: MarkdownMatch,
  text: string,
  edge: string,
): boolean {
  if (isBlockText(text) || wholeBlock(match)) return true;
  return edge.trim() === "" && !isParagraph(match.markdown);
}

/** `text` without blank lines around it, but with its first line's
 *  indentation - a nested list item's indent is part of its meaning. */
function trimLines(text: string): string {
  return text.replace(/^\s*\n/, "").replace(/\s+$/, "");
}

/**
 * The markdown those blocks should become - composed in markdown space, so
 * whatever formatting the prefix/suffix carried is preserved verbatim rather
 * than being re-derived from a lossy plain-text round trip.
 *
 * The kept text for insert actions is sliced out of the DOCUMENT's markdown
 * (what the match actually covered), not taken from the model's quote - a
 * whitespace-tolerant match means the two can differ, and the model's
 * version must never reformat what it was only inserting next to.
 */
export function composeMarkdownEdit(
  match: MarkdownMatch,
  action: EditAction,
  text: string,
): string {
  const matched = match.markdown.slice(
    match.prefix.length,
    match.markdown.length - match.suffix.length,
  );
  let middle: string;
  switch (action) {
    case "delete":
      middle = "";
      break;
    // A new row or list item next to a whole row or item joins its table
    // or list line by line. Otherwise a new block only where one belongs
    // (startsBlock). Anything else is part of the sentence - always
    // breaking out a paragraph turned "add 'in 2024' after 'the study'"
    // into three paragraphs, and a sentence added after a paragraph's last
    // sentence into a paragraph of its own.
    case "insert_before": {
      const line = (matched + match.suffix).split("\n")[0];
      const lines = trimLines(text);
      const atLineStart = match.prefix === "" || match.prefix.endsWith("\n");
      if (atLineStart && sameLineKind(lines.split("\n").pop() ?? "", line))
        middle = `${lines}\n${matched}`;
      else if (startsBlock(match, text, match.prefix))
        middle = `${text.trim()}${BLOCK_SEPARATOR}${matched}`;
      else middle = joinInline(text, matched);
      break;
    }
    case "insert_after": {
      const line = (match.prefix + matched).split("\n").pop() ?? "";
      const lines = trimLines(text);
      const atLineEnd = match.suffix === "" || match.suffix.startsWith("\n");
      if (atLineEnd && sameLineKind(line, lines.split("\n")[0]))
        middle = `${matched}\n${lines}`;
      else if (startsBlock(match, text, match.suffix))
        middle = `${matched}${BLOCK_SEPARATOR}${text.trim()}`;
      else middle = joinInline(matched, text);
      break;
    }
    default:
      middle = text;
      break;
  }
  return `${match.prefix}${middle}${match.suffix}`;
}
