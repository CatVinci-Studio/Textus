import {
  Fragment,
  Slice,
  type Node as ProseNode,
} from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { writeClipboard } from "../images/picture-clipboard";
import { tellCopied } from "../../clipboard/copied";

/**
 * A copied table as Word, Pages, WeChat and the spreadsheets read one: a
 * head row in <thead>, lines round every cell, and a cell's text without
 * the paragraph each one holds (which spaced rows out there). Textus reads
 * it back as the same table.
 */

// Inline, as other apps take no stylesheet with a paste.
// design: allow - a pasted table's own lines and padding, outside the app.
const CELL = "border:1px solid #c8c8c8;padding:4px 8px;vertical-align:top";

export function tidyTablesForClipboard(root: ParentNode): void {
  for (const table of root.querySelectorAll("table")) {
    table.setAttribute("border", "1");
    table.setAttribute("style", "border-collapse:collapse");
    const head = table.querySelector(":scope > tbody > tr[data-is-header]");
    if (head) {
      const thead = table.ownerDocument.createElement("thead");
      table.insertBefore(thead, table.firstChild);
      thead.append(head);
    }
  }
  // Rows copied without their table get their table round them later
  // (ProseMirror's own wrapping): their cells are styled here all the same.
  for (const cell of root.querySelectorAll("th, td")) {
    const align = (cell as HTMLElement).style.textAlign;
    cell.setAttribute("style", align ? `${CELL};text-align:${align}` : CELL);
    unwrapParagraphs(cell);
  }
}

/** A cell's paragraphs as lines of one text. */
function unwrapParagraphs(cell: Element) {
  const paragraphs = [...cell.children];
  if (!paragraphs.length || paragraphs.some((p) => p.tagName !== "P")) return;
  const doc = cell.ownerDocument;
  paragraphs.forEach((p, i) => {
    if (i > 0) cell.insertBefore(doc.createElement("br"), p);
    p.replaceWith(...p.childNodes);
  });
}

/** A table as Markdown and as the HTML other apps read: Copy Table. */
export function tableCopy(
  view: EditorView,
  table: ProseNode,
  serialize: (doc: ProseNode) => string,
): { markdown: string; html: string } {
  const doc = view.state.schema.topNodeType.create(null, table);
  const { dom } = view.serializeForClipboard(
    new Slice(Fragment.from(table), 0, 0),
  );
  return { markdown: serialize(doc).trimEnd() + "\n", html: dom.innerHTML };
}

export function copyTable(
  view: EditorView,
  table: ProseNode,
  serialize: (doc: ProseNode) => string,
): Promise<void> {
  const { markdown, html } = tableCopy(view, table, serialize);
  // Rejects when nothing was copied, so no "Copied" shows.
  return writeClipboard(html, markdown, null).then(() => tellCopied(markdown));
}
