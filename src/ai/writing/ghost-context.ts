import type { CompletionHints } from "../../platform/ipc";
import { cjkChunk, isCjk, isCjkLetter } from "../../utils/cjk";
import { headingTrail } from "../doc-markdown";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";

/** What a completion is asked with and how its reply is tidied and split:
 *  pure functions of the document. */

// More context costs on every request and barely changes the suggestion.
export const MAX_CONTEXT_CHARS = 1500;
// Enough to lead into what follows mid-document without dominating the prompt.
export const MAX_AFTER_CONTEXT_CHARS = 300;

/** Strips the leading space models often add after CJK text, which doesn't
 *  separate words with spaces. After Latin text the space is kept. */
export function tidySuggestion(
  before: string,
  suggestion: string,
  oneLine = false,
): string {
  const text = isCjk(before.slice(-1))
    ? suggestion.replace(/^[ \t]+/, "")
    : suggestion;
  // A line break in a table cell or heading would split it on save.
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

/** Cuts a continuation's repeat of the before-text's end, which Tab would
 *  insert twice. Short overlaps stay, as they are ordinary prose. */
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
  // Otherwise the model has to guess it is continuing code.
  code_block: "code block",
};

/** What the text around the cursor can't say: the title, the section, and
 *  the kind of block. Runs once per request, not per keystroke. */
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

/** The prose between two positions, less code blocks and inline atoms, so
 *  code keywords aren't taken for the writer's language. */
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
  // A bounded window, as this runs on every keystroke before the debounce.
  // The 4x margin covers block boundaries, which take positions but no text.
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

/** The next piece Ctrl/Cmd+Right accepts: leading space plus one word, or up
 *  to two CJK characters. */
export function nextWordChunk(text: string): string {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const rest = text.slice(lead.length);
  if (!rest) return text;
  if (isCjkLetter(rest[0])) return lead + (cjkChunk(rest) ?? rest[0]);
  const m = /^\S+/.exec(rest);
  return lead + (m ? m[0] : rest);
}

/** The alternatives in a multi-candidate response. The separator is cut
 *  wherever it sits; a candidate's leading space is kept as its join. */
export function splitCandidates(raw: string): string[] {
  return raw.split(/\s*<<<>>>(?:[ \t]*\n)*/).filter((part) => part.trim());
}

/** Right after raw HTML ("</details>", a table): text written on its
 *  line becomes part of the HTML block when the file is read again, so a
 *  continuation there would vanish into the markup. */
export function afterRawHtml($pos: ResolvedPos): boolean {
  return $pos.nodeBefore?.type.name === "html";
}
