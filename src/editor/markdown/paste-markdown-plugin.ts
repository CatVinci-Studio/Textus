import { Plugin, type Selection } from "@milkdown/kit/prose/state";
import { Slice } from "@milkdown/kit/prose/model";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { parseMarkdownSource } from "./parse-markdown-source";
import { fillTable, inTableCell, joinLinesForTableCell } from "./paste-slice";
import { wordListsToHtml } from "./word-lists";
import { keepPastedLines } from "./paste-lines";
import { cleanPastedHtml } from "./paste-html";

/**
 * Milkdown's clipboard plugin only parses pasted text as markdown when the
 * clipboard carries NO text/html flavor at all - but nearly every source
 * (browsers, chat apps, code editors, Word) attaches an HTML flavor even for
 * what is visually plain text, so pasted markdown source ("$x^2$",
 * "**bold**") lands as literal characters via the HTML path. When that HTML
 * is merely a styled wrapper around plain text - no semantically rich tags -
 * the markdown source in text/plain is the better representation: parse it,
 * exactly like the clipboard plugin's no-HTML branch would. Genuinely rich
 * HTML (links, tables, real formatting) still goes through the HTML path
 * untouched. Must be registered BEFORE the clipboard plugin - handlePaste
 * props run in registration order and the first to return true wins.
 * Every paste also keeps the spans at its ends (keepPastedSpans below),
 * and lines pasted into a table cell stay in it (paste-slice.ts); pasted
 * text keeps its line breaks, and a quote copied with its bars is a quote
 * (paste-lines.ts); pasted HTML keeps what its styles meant (paste-html.ts).
 */

const RICH_HTML_SELECTOR = [
  "a",
  "b",
  "strong",
  "em",
  "i",
  "u",
  "s",
  "del",
  "mark",
  "code",
  "pre",
  "kbd",
  "img",
  "video",
  "table",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "hr",
  "sub",
  "sup",
].join(",");

function htmlIsStyledPlainText(html: string): boolean {
  const template = document.createElement("template");
  template.innerHTML = html;
  // Every custom node type this editor defines (md_span, md_code_span,
  // math_inline, math_block, ...) marks its wrapper element with data-type -
  // that's real node data, not styling, regardless of which (possibly bare
  // span/div) tag it rides on. Content copied from Textus itself - even back
  // into Textus - would otherwise get misread as "styled plain text" here:
  // its wrapper tags aren't in RICH_HTML_SELECTOR, so this plugin would
  // discard the HTML and re-parse the plain-text fallback as markdown
  // instead, which for math nodes (whose text content is bare LaTeX with no
  // $ delimiters) silently drops the formula entirely.
  if (template.content.querySelector("[data-type]")) return false;
  return !template.content.querySelector(RICH_HTML_SELECTOR);
}

/**
 * How deep a pasted slice stays open at one end: through its blocks, which
 * join the paragraph pasted into, but through bold, italic, code or maths
 * only where the paste lands inside a span just like it. An open span's
 * content is poured into the node at the caret, so `**bold** text` pasted
 * into a paragraph came in as plain "bold text": every paste - Markdown
 * text, a web page's <strong> - lost the span it started with.
 */
function openDepth(slice: Slice, $pos: ResolvedPos, end: "start" | "end") {
  const open = end === "start" ? slice.openStart : slice.openEnd;
  const spans: ProseNode[] = [];
  for (let depth = 1; depth <= $pos.depth; depth++)
    if ($pos.node(depth).isInline) spans.push($pos.node(depth));
  let depth = 0;
  let node =
    end === "start" ? slice.content.firstChild : slice.content.lastChild;
  while (node && depth < open) {
    if (node.isInline && !spans.shift()?.sameMarkup(node)) break;
    depth++;
    node = end === "start" ? node.firstChild : node.lastChild;
  }
  return depth;
}

/** `slice` closed where it would lose a span when pasted at `selection`. */
export function keepPastedSpans(slice: Slice, selection: Selection): Slice {
  const openStart = openDepth(slice, selection.$from, "start");
  const openEnd = openDepth(slice, selection.$to, "end");
  return openStart === slice.openStart && openEnd === slice.openEnd
    ? slice
    : new Slice(slice.content, openStart, openEnd);
}

/** Blocks a paste keeps whole, rather than pouring into the line. */
const WHOLE_BLOCKS = new Set([
  "blockquote",
  "code_block",
  "math_block",
  "table",
]);
const keepsItsShape = (node: ProseNode | null) =>
  !!node && WHOLE_BLOCKS.has(node.type.name);

/** Opened, a quote or code block was poured into the line: a quote starting
 *  with a list lost its quote, and code became text. Copies from Textus
 *  keep it only on an empty line, as a piece of code pasted into text is
 *  text. A table cell holds one paragraph, so there it stays poured. */
export function keepPastedBlock(
  slice: Slice,
  $pos: ResolvedPos,
  onAnyLine: boolean,
): Slice {
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return slice;
  if (inTableCell($pos)) return slice;
  const { firstChild, lastChild } = slice.content;
  const openStart =
    keepsItsShape(firstChild) && (onAnyLine || $pos.parent.content.size === 0)
      ? 0
      : slice.openStart;
  const openEnd = onAnyLine && keepsItsShape(lastChild) ? 0 : slice.openEnd;
  return openStart === slice.openStart && openEnd === slice.openEnd
    ? slice
    : new Slice(slice.content, openStart, openEnd);
}

/**
 * Whether the parsed paste is one line of a block other than a paragraph -
 * `# T`, `- x`, `> q` - landing in a line that has text: its text joins
 * that line and the block is gone, so "# T" pasted mid-sentence came in
 * as "T". It is pasted as the text it is instead.
 */
function mergesAway(doc: ProseNode, $pos: ResolvedPos): boolean {
  if (doc.childCount !== 1 || !$pos.parent.isTextblock) return false;
  if ($pos.parent.content.size === 0) return false;
  const block = doc.firstChild!;
  if (block.type.name === "paragraph" || block.type.spec.code) return false;
  let lines = 0;
  let table = false;
  block.descendants((node) => {
    if (node.type.spec.tableRole) table = true;
    if (node.isTextblock) lines++;
    return !node.isTextblock;
  });
  if (block.isTextblock) lines = 1;
  return !table && lines === 1;
}

export const pasteMarkdownSourcePlugin = $prose(
  (ctx) =>
    new Plugin({
      props: {
        // Pasted HTML, Textus's own copies and drags: ProseMirror's slice,
        // which the clipboard plugin pastes as it is.
        transformPasted: (slice, view) =>
          joinLinesForTableCell(
            keepPastedSpans(
              keepPastedBlock(slice, view.state.selection.$from, false),
              view.state.selection,
            ),
            view.state.selection.$from,
          ),
        transformPastedHTML: (html) => cleanPastedHtml(wordListsToHtml(html)),
        handlePaste(view, event) {
          const data = event.clipboardData;
          if (!data) return false;
          if (view.state.selection.$from.node().type.spec.code) return false; // inside code: paste stays literal
          if (data.getData("vscode-editor-data")) return false; // clipboard plugin turns these into a code block
          const html = cleanPastedHtml(
            wordListsToHtml(data.getData("text/html")),
          );
          const text = data.getData("text/plain");
          if (!text || (html && !htmlIsStyledPlainText(html))) return false;

          // Its lines as the writer saw them (paste-lines.ts).
          const lined = keepPastedLines(text);
          const doc = parseMarkdownSource(ctx, lined);
          if (!doc || typeof doc === "string" || doc.content.size === 0)
            return false;
          if (mergesAway(doc, view.state.selection.$from)) {
            view.dispatch(
              view.state.tr
                .insertText(text.replace(/[\r\n]+$/, ""))
                .setMeta("uiEvent", "paste")
                .scrollIntoView(),
            );
            return true;
          }
          // A table pasted into a table: its cells fill the table from the
          // caret's cell on, as a copy of cells from a table does.
          if (
            inTableCell(view.state.selection.$from) &&
            doc.childCount === 1 &&
            doc.firstChild!.type.spec.tableRole === "table"
          ) {
            const $from = view.state.selection.$from;
            let depth = $from.depth;
            while ($from.node(depth).type.spec.tableRole !== "table") depth--;
            const table = $from.node(depth);
            const filled = fillTable(
              table,
              $from.index(depth),
              $from.index(depth + 1),
              doc.firstChild!,
            );
            const at = $from.before(depth);
            view.dispatch(
              view.state.tr
                .replaceWith(at, at + table.nodeSize, filled)
                .setMeta("uiEvent", "paste")
                .scrollIntoView(),
            );
            return true;
          }
          const parsed = Slice.maxOpen(doc.content);
          const slice = joinLinesForTableCell(
            keepPastedSpans(
              keepPastedBlock(parsed, view.state.selection.$from, true),
              view.state.selection,
            ),
            view.state.selection.$from,
          );
          // Text alone the clipboard plugin's own branch markdown-parses
          // too, but into a slice open through the spans at its ends (and
          // lines it would spread over a table's cells).
          if (!html && slice === parsed && lined === text) return false;
          view.dispatch(
            view.state.tr
              .replaceSelection(slice)
              // As ProseMirror marks its own pastes (br-hardbreak-plugin.ts).
              .setMeta("uiEvent", "paste")
              .scrollIntoView(),
          );
          return true;
        },
      },
    }),
);
