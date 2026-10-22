import type { CompletionHints } from "../../platform/ipc";
import { cjkChunk, isCjk, isCjkLetter } from "../../utils/cjk";
import { headingTrail } from "../doc-markdown";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";

/**
 * What a completion is asked with and what is shown of it: the prose
 * around the caret and where it is, the reply tidied and split into
 * candidates, the next word Tab takes (ghost-text-plugin.ts). Pure
 * functions of the document.
 */

// The section around the caret is what the next words follow from; more
// before it cost on every request and changed little (completion_replay).
export const MAX_CONTEXT_CHARS = 1500;
// Look-ahead after the cursor: enough for the model to lead into what
// follows when completing mid-document, small enough not to dominate the
// prompt.
export const MAX_AFTER_CONTEXT_CHARS = 300;

/**
 * Models often start a continuation with a space out of English habit; after
 * CJK text (or CJK punctuation) that space is wrong - CJK doesn't separate
 * with spaces - so it's stripped. Latin before-text keeps the suggestion
 * verbatim: a leading space there is usually a correct word boundary.
 */
export function tidySuggestion(
  before: string,
  suggestion: string,
  oneLine = false,
): string {
  const text = isCjk(before.slice(-1))
    ? suggestion.replace(/^[ \t]+/, "")
    : suggestion;
  // A table cell or a heading holds one line: a line break taken into one
  // split the table row (or the heading) when the file was saved.
  return oneLine ? text.replace(/[ \t]*\n+[ \t]*/g, " ").trimEnd() : text;
}

/** Whether the caret's block is one line in Markdown (a table cell, a
 *  heading), where a suggestion can't carry a line break. */
export function isOneLineBlock(doc: ProseNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  if ($pos.parent.type.name === "heading") return true;
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.spec.tableRole?.endsWith("cell")) return true;
  }
  return false;
}

/**
 * Models sometimes open the continuation by repeating the end of the
 * before-text ("...the results show" -> "the results show that ..."),
 * which Tab would then insert twice. A repeat of at least a few words is
 * cut; a short overlap is left alone, since "the " ending one sentence and
 * starting the next is ordinary prose.
 */
export function stripEcho(before: string, suggestion: string): string {
  const max = Math.min(before.length, suggestion.length, 200);
  for (let k = max; k >= 6; k--) {
    if (before.endsWith(suggestion.slice(0, k))) return suggestion.slice(k);
  }
  return suggestion;
}

export const BLOCK_NAMES: Record<string, string> = {
  heading: "heading",
  list_item: "list item",
  blockquote: "blockquote",
  table_cell: "table cell",
  table_header: "table cell",
  // Without it a code block went out as a "paragraph" and the model had to
  // guess it was continuing code (the live eval scored the hinted case
  // higher - docs/design/ai-eval.md).
  code_block: "code block",
};

/**
 * What the 2000 characters around the cursor can't say on their own: what
 * the document is (its first heading), which section is being written (the
 * heading path down to the cursor), and what kind of block the cursor is in
 * - without which a completion inside a list item or a heading came back as
 * a full prose sentence. Walks top-level blocks only, and runs once per
 * request (inside the debounce), not per keystroke.
 */
export function completionHints(
  doc: ProseNode,
  cursorPos: number,
  length: CompletionHints["length"],
): CompletionHints {
  const { title, path } = headingTrail(doc, cursorPos);

  const $pos = doc.resolve(cursorPos);
  let block = "paragraph";
  for (let depth = $pos.depth; depth > 0; depth--) {
    const name = BLOCK_NAMES[$pos.node(depth).type.name];
    if (name) {
      block = name;
      break;
    }
  }
  // The heading being typed in isn't a section *around* the cursor yet.
  const section = block === "heading" ? [] : path.slice(-4).map((h) => h.text);
  return { title, section, block, length };
}

/**
 * The prose between two positions: the text of its textblocks, less code
 * blocks (a Mermaid diagram's source among them) and inline atoms such as
 * math. Keywords like `graph TD` aren't a language the writer writes in:
 * read as one, a document opening with a diagram got continuations in
 * Russian in a Chinese app.
 */
export function proseText(doc: ProseNode, from: number, to: number): string {
  const parts: string[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    const start = Math.max(0, from - pos - 1);
    const end = Math.min(node.content.size, to - pos - 1);
    const text = node.textBetween(start, end, undefined, () => "");
    if (text) parts.push(text);
    return false;
  });
  return parts.join("\n\n");
}

/** Whether there are words to continue: some letter in the prose. */
export function hasProse(prose: string): boolean {
  return /\p{L}/u.test(prose);
}

export function completionContext(
  doc: ProseNode,
  cursorPos: number,
): { before: string; after: string; prose: string } {
  // Scanned over a bounded window around the cursor, not the whole document:
  // this runs on every keystroke at a block end, BEFORE the debounce. A
  // character occupies at least one position, so a 4x-margin position window
  // always covers the characters actually kept below (block boundaries eat
  // positions without emitting characters - hence the margin, not 1x).
  const from = Math.max(0, cursorPos - 4 * MAX_CONTEXT_CHARS);
  const to = Math.min(
    doc.content.size,
    cursorPos + 4 * MAX_AFTER_CONTEXT_CHARS,
  );
  const before = doc.textBetween(from, cursorPos, "\n\n");
  const after = doc.textBetween(cursorPos, to, "\n\n");
  const proseBefore = proseText(doc, from, cursorPos);
  const proseAfter = proseText(doc, cursorPos, to);
  return {
    before: before.slice(Math.max(0, before.length - MAX_CONTEXT_CHARS)),
    after: after.slice(0, MAX_AFTER_CONTEXT_CHARS),
    prose: [
      proseBefore.slice(Math.max(0, proseBefore.length - MAX_CONTEXT_CHARS)),
      proseAfter.slice(0, MAX_AFTER_CONTEXT_CHARS),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * The next piece of a suggestion that Ctrl/Cmd+Right accepts on its own:
 * leading space plus one word - or, for CJK text, which has no spaces to
 * find words by, up to two characters (and any punctuation right after).
 */
export function nextWordChunk(text: string): string {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const rest = text.slice(lead.length);
  if (!rest) return text;
  if (isCjkLetter(rest[0])) return lead + (cjkChunk(rest) ?? rest[0]);
  const m = /^\S+/.exec(rest);
  return lead + (m ? m[0] : rest);
}

/** The alternatives in a multi-candidate response (CANDIDATE_SEPARATOR in
 *  src-tauri ai/client.rs); a single continuation comes back as one. Only
 *  whole lines after the separator go with it: a candidate's leading space
 *  is the join the backend made onto the before-text ("quickly" + " grew").
 *  The separator is cut wherever it sits - at the very start (the first
 *  alternative was dropped) or on a candidate's own line, which a model
 *  sometimes writes - rather than only on a line of its own; left in, Tab
 *  inserted "<<<>>>" into the document. */
export function splitCandidates(raw: string): string[] {
  return raw.split(/\s*<<<>>>(?:[ \t]*\n)*/).filter((part) => part.trim());
}

/** Right after raw HTML ("</details>", a table): text written on its
 *  line becomes part of the HTML block when the file is read again, so a
 *  continuation there would vanish into the markup. */
export function afterRawHtml($pos: ResolvedPos): boolean {
  return $pos.nodeBefore?.type.name === "html";
}
