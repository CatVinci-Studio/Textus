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
    for (const cell of table.querySelectorAll("th, td")) {
      const align = (cell as HTMLElement).style.textAlign;
      cell.setAttribute("style", align ? `${CELL};text-align:${align}` : CELL);
      unwrapParagraphs(cell);
    }
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
