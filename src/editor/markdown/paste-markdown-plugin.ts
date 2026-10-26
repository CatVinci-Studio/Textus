import { Plugin, type Selection } from "@milkdown/kit/prose/state";
import { Slice } from "@milkdown/kit/prose/model";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { parseMarkdownSource } from "./parse-markdown-source";
import { joinLinesForTableCell } from "./paste-slice";
import { wordListsToHtml } from "./word-lists";
import { keepPastedLines } from "./paste-lines";
import { cleanPastedHtml } from "./paste-html";

/**
 * Milkdown parses pasted text as markdown only when the clipboard has no
 * text/html at all, yet nearly every source attaches HTML to plain text.
 * When that HTML is just styled plain text, the text/plain markdown is
 * parsed instead. Registered before the clipboard plugin: the first
 * handlePaste to return true wins.
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
  // Textus's own node types mark their wrappers with data-type: that's node
  // data, and re-parsing their plain text would drop math formulas.
  if (template.content.querySelector("[data-type]")) return false;
  return !template.content.querySelector(RICH_HTML_SELECTOR);
}

/**
 * How deep a pasted slice stays open at one end: through its blocks, but
 * through a span only where the paste lands inside one like it. An open
 * span's content is poured into the node at the caret, losing the span.
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

/**
 * Whether the parsed paste is one line of a non-paragraph block landing in
 * a line with text, which would merge it away ("# T" mid-sentence came in as
 * "T"). It is pasted as the text it is instead.
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
        // Pasted HTML, Textus's own copies and drags: ProseMirror's slice, which
        // the clipboard plugin pastes as it is.
        transformPasted: (slice, view) =>
          joinLinesForTableCell(
            keepPastedSpans(slice, view.state.selection),
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
          const parsed = Slice.maxOpen(doc.content);
          const slice = joinLinesForTableCell(
            keepPastedSpans(parsed, view.state.selection),
            view.state.selection.$from,
          );
          // The clipboard plugin's own branch parses text alone too, but into a slice
          // open through the spans at its ends.
          if (!html && slice === parsed && lined === text) return false;
          view.dispatch(
            view.state.tr
              .replaceSelection(slice)
              // As ProseMirror marks its own pastes.
              .setMeta("uiEvent", "paste")
              .scrollIntoView(),
          );
          return true;
        },
      },
    }),
);
