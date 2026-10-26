import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { isCjk } from "../utils/cjk";
import { serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { Selection, type EditorState } from "@milkdown/kit/prose/state";
import { blockMarkdown } from "../editor/markdown/block-markdown";
import type { EditAction } from "./types";
import {
  blockIds,
  blockKind,
  runOf,
  type BlockKind,
  type SentBlock,
} from "./doc-blocks";

/**
 * The document as markdown source, the one representation every AI edit path
 * works in: what the model reads, where an edit's words are found, and what
 * is parsed on accept. Each block keeps its ProseMirror range alongside.
 */

const BLOCK_SEPARATOR = "\n\n";

export interface MarkdownBlock {
  /** ProseMirror position immediately before the block node. */
  from: number;
  /** ProseMirror position immediately after the block node. */
  to: number;
  /** The block serialized to markdown, without trailing blank lines. */
  markdown: string;
  /** Where this block's markdown starts inside documentMarkdown()'s output. */
  offset: number;
  id: string;
  kind: BlockKind;
}

/** The current selection in the forms every AI surface needs. Shared so
 *  Quick Ask and the detached chat agree on what "the selection" is. */
export interface SelectionSnapshot {
  /** Plain text, for display only. */
  selectedText: string | null;
  /** Markdown: what the model is shown, and what a replace_selection
   *  proposal's staleness check compares against. */
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
 * click reaches the start of the next paragraph, and a rewrite of that range
 * would join the two on accept.
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

/** The caret and the plain text around it, when nothing is selected. */
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
 * Every top-level block with its markdown and its ProseMirror range,
 * serialized one at a time so each markdown is anchored to an exact range.
 */
export function serializeBlocks(ctx: Ctx, doc: ProseNode): MarkdownBlock[] {
  const blocks: Omit<MarkdownBlock, "id">[] = [];
  let offset = 0;
  doc.forEach((node, pos) => {
    // Cached per block: after an edit only the blocks it touched are serialized again.
    const markdown = blockMarkdown(ctx, node).trimEnd();
    const kind = blockKind(node);
    blocks.push({ from: pos, to: pos + node.nodeSize, markdown, offset, kind });
    offset += markdown.length + BLOCK_SEPARATOR.length;
  });
  const ids = blockIds(blocks.map((b) => b.markdown));
  return blocks.map((b, i) => ({ ...b, id: ids[i] }));
}

/** The whole document as one markdown string. */
export function documentMarkdown(
  blocks: readonly { markdown: string }[],
): string {
  return blocks.map((block) => block.markdown).join(BLOCK_SEPARATOR);
}

/** The document as a request carries it: its blocks and their markdown
 *  joined, so the model, backend and editor never split it two ways. */
export interface DocumentSnapshot {
  markdown: string;
  blocks: SentBlock[];
}

/**
 * `documentMarkdown(serializeBlocks(...))`, cached per immutable doc: while
 * the user drag-selects, the doc is unchanged on every mousemove.
 */
const documentCache = new WeakMap<ProseNode, DocumentSnapshot>();

export function cachedDocument(ctx: Ctx, doc: ProseNode): DocumentSnapshot {
  const cached = documentCache.get(doc);
  if (cached !== undefined) return cached;
  const blocks = serializeBlocks(ctx, doc);
  const snapshot = {
    markdown: documentMarkdown(blocks),
    blocks: blocks.map(({ id, markdown, kind }) => ({ id, markdown, kind })),
  };
  documentCache.set(doc, snapshot);
  return snapshot;
}

/** `cachedDocument`'s markdown alone. */
export function cachedDocumentMarkdown(ctx: Ctx, doc: ProseNode): string {
  return cachedDocument(ctx, doc).markdown;
}

/**
 * A resolved target: the ProseMirror range of the whole blocks it touches,
 * plus the markdown around the quoted words. A markdown offset inside a block
 * has no ProseMirror position, so the edit re-parses those whole blocks.
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

/** What an edit, a comment or a picture names: its block (and the run's
 *  last), and the words inside them, or the whole run without `anchor`. */
export interface BlockTarget {
  block?: string;
  lastBlock?: string;
  anchor?: string;
}

/**
 * Where `target` is in the document now. Null when an id is gone (the block
 * changed) or the words don't occur in the run exactly once; never guessed.
 */
export function matchTarget(
  blocks: MarkdownBlock[],
  target: BlockTarget,
): MarkdownMatch | null {
  if (!target.block) return null;
  const run = runOf(blocks, target.block, target.lastBlock);
  if (!run) return null;
  const doc = documentMarkdown(blocks);
  const runStart = blocks[run.first].offset;
  const runEnd = blocks[run.last].offset + blocks[run.last].markdown.length;
  const runText = doc.slice(runStart, runEnd);
  const quote = target.anchor;
  if (!quote || quote === runText)
    return {
      from: blocks[run.first].from,
      to: blocks[run.last].to,
      prefix: "",
      suffix: "",
      markdown: runText,
    };
  const at = runText.indexOf(quote);
  if (at === -1 || runText.indexOf(quote, at + 1) !== -1) return null;
  const start = runStart + at;
  const end = start + quote.length;
  const startIdx = blockIndexAt(blocks, start);
  // `end` is exclusive, so probe the last character the quote covers.
  const endIdx = Math.max(startIdx, blockIndexAt(blocks, end - 1));
  const first = blocks[startIdx];
  const last = blocks[endIdx];
  const spanStart = first.offset;
  const spanEnd = last.offset + last.markdown.length;
  return {
    from: first.from,
    to: last.to,
    prefix: doc.slice(spanStart, start),
    suffix: doc.slice(end, spanEnd),
    markdown: doc.slice(spanStart, spanEnd),
  };
}

/** Whether `text` is block content of its own (several paragraphs, a block
 *  line, or an image alone) rather than words for a sentence. */
function isBlockText(text: string): boolean {
  const trimmed = text.trim();
  return (
    /\n\s*\n/.test(trimmed) ||
    /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\|)/.test(trimmed) ||
    /^!\[[^\]\n]*\]\([^)\n]*\)$/.test(trimmed)
  );
}

/** Joins two runs of inline text with the space Latin script needs, but none
 *  between CJK characters, before punctuation or before a footnote reference. */
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

/** Whether two lines are rows of one table or items of one list. A blank line
 *  would end the table, and trimming a nested item's indent would unnest it. */
function sameLineKind(a: string, b: string): boolean {
  return (
    (TABLE_ROW.test(a) && TABLE_ROW.test(b)) ||
    (LIST_ITEM.test(a) && LIST_ITEM.test(b))
  );
}

function wholeBlock(match: MarkdownMatch): boolean {
  return match.prefix.trim() === "" && match.suffix.trim() === "";
}

/** Whether the matched markdown is one plain paragraph. */
function isParagraph(markdown: string): boolean {
  return !isBlockText(markdown) && !/^\s*(<|\$\$|\[\^|---)/.test(markdown);
}

/** Whether text inserted on the `edge` side of the match starts a block of its
 *  own. Only a paragraph carries on past its last sentence: glued onto a table
 *  row it becomes a cell, onto a heading or list item it joins them. */
function startsBlock(
  match: MarkdownMatch,
  text: string,
  edge: string,
): boolean {
  if (isBlockText(text) || wholeBlock(match)) return true;
  return edge.trim() === "" && !isParagraph(match.markdown);
}

/** `text` without blank lines around it, keeping its first line's indent,
 *  which carries a nested list item's meaning. */
function trimLines(text: string): string {
  return text.replace(/^\s*\n/, "").replace(/\s+$/, "");
}

/**
 * The markdown those blocks should become, composed in markdown space so the
 * prefix/suffix formatting is kept verbatim. Insert actions keep the
 * document's matched text, never the model's quote, which may differ.
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
    // A new row or item next to a whole row or item joins line by line; a new
    // block only where one belongs; anything else joins the sentence.
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
