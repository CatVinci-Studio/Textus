// Page-seam layout for the PDF export. WebKit never paints an @page margin,
// so the sheet has none and the margin is laid out: blocks that would cross
// a seam or start in a margin band are pushed down by spacers.

/** The sheet as the PDF renderer lays it out, in CSS px. */
export interface PageGeometry {
  width: number;
  height: number;
  /** ~20mm band at the top and bottom of each sheet, matching the sides. */
  margin: number;
}

/** macOS: createPDF renders 1 CSS px as 1 pt, so the sheet is A4 in points.
 *  NSPrintOperation's page height depends on the printer, so it can't match. */
export const MAC_PAGE: PageGeometry = { width: 595, height: 842, margin: 57 };

/** Windows: PrintToPdf lays out at 96 CSS px per inch, cutting pages at
 *  whole pixels. */
export const WINDOWS_PAGE: PageGeometry = {
  width: 794,
  height: 1122,
  margin: 76,
};

const SPACER_CLASS = "textus-page-spacer";

// Containers cut between their children when taller than a page.
function isSplittable(el: Element): boolean {
  return /^(UL|OL|LI|BLOCKQUOTE|TABLE|DIV)$/.test(el.tagName);
}

/** Code and paragraphs, cut between lines. */
function isTextBlock(el: Element): boolean {
  return /^(PRE|P)$/.test(el.tagName) && /\S/.test(el.textContent ?? "");
}

function makeSpacer(doc: Document): HTMLElement {
  const div = doc.createElement("div");
  div.className = SPACER_CLASS;
  div.setAttribute("aria-hidden", "true");
  div.style.cssText =
    "display:block;margin:0;padding:0;border:0;list-style:none;height:0";
  return div;
}

/** A table's first row if it is all header cells. */
function headerRow(table: Element): Element | null {
  const head = (table as HTMLTableElement).rows[0];
  return head && Array.from(head.cells).every((cell) => cell.tagName === "TH")
    ? head
    : null;
}

/**
 * Moves everything in `el` from `node` on into a shallow copy inserted after
 * it, and returns the copy. Tables repeat their header; ordered lists go on
 * counting.
 */
export function splitBefore(el: Element, node: Node, offset?: number): Element {
  const range = el.ownerDocument.createRange();
  if (offset === undefined) range.setStartBefore(node);
  else range.setStart(node, offset);
  range.setEnd(el, el.childNodes.length);
  const rest = el.cloneNode(false) as HTMLElement;
  rest.append(range.extractContents());
  if (el.tagName === "TABLE") {
    const head = headerRow(el);
    if (head) rest.querySelector("tr")?.before(head.cloneNode(true));
    const columns = el.querySelector(":scope > colgroup");
    if (columns) rest.prepend(columns.cloneNode(true));
  } else if (el.tagName === "OL") {
    const before = el.querySelectorAll(":scope > li").length;
    rest.setAttribute("start", String((el as HTMLOListElement).start + before));
  } else if (el.tagName === "P") {
    // The rest of a paragraph, not a new one.
    rest.style.textIndent = "0";
  }
  el.after(rest);
  return rest;
}

/** Where `block`'s text breaks so what comes before ends above `limit`; a
 *  wrapped code line stays whole. Null if no line fits, or every line does. */
function textBreak(
  block: Element,
  limit: number,
  scrollTop: number,
): [Text, number] | null {
  const doc = block.ownerDocument;
  const chars: [Text, number][] = [];
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    for (let i = 0; i < (node as Text).length; i++)
      chars.push([node as Text, i]);
  const lineHeight = parseFloat(getComputedStyle(block).lineHeight);
  const range = doc.createRange();
  const below = ([node, i]: [Text, number]) => {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rect = range.getBoundingClientRect();
    // White space collapsed at a line's end has no box; it ends that line.
    if (rect.height === 0) return false;
    // A glyph's box is the font's height; its line adds half the leading.
    const leading = Math.max(0, (lineHeight || rect.height) - rect.height);
    return rect.bottom + scrollTop + leading / 2 > limit;
  };
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (below(chars[mid])) hi = mid;
    else lo = mid + 1;
  }
  let at = lo;
  if (block.tagName === "PRE")
    while (at > 0 && chars[at - 1][0].data[chars[at - 1][1]] !== "\n") at--;
  return at > 0 && at < chars.length ? chars[at] : null;
}

/** The next sibling that takes up space; a diagram's hidden source block
 *  can sit in between. */
function nextVisible(el: Element): Element | null {
  let next = el.nextElementSibling;
  while (next && next.getBoundingClientRect().height === 0)
    next = next.nextElementSibling;
  return next;
}

/** A heading, or a paragraph ending in a colon ("Label:"): a line that
 *  introduces the block after it. */
function introduces(el: Element): boolean {
  return (
    /^H[1-6]$/.test(el.tagName) ||
    (el.tagName === "P" && /[:：]\s*$/.test(el.textContent ?? ""))
  );
}

/**
 * Inserts spacers into `root` so no block straddles a seam or sits in a
 * margin band, re-measuring after each, since every spacer moves the rest.
 */
export function paginateDocument(
  doc: Document,
  root: Element,
  pageHeight = MAC_PAGE.height,
  margin = MAC_PAGE.margin,
): number {
  const usable = pageHeight - 2 * margin;
  const scrollTop = () => doc.defaultView?.scrollY ?? 0;
  const top = (el: Element) => el.getBoundingClientRect().top + scrollTop();
  const bottom = (el: Element) =>
    el.getBoundingClientRect().bottom + scrollTop();
  let inserted = 0;

  const place = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) return;
    const start = top(el);
    const page = Math.floor(start / pageHeight);
    const pageTop = page * pageHeight;
    const contentTop = pageTop + margin;
    const contentEnd = pageTop + pageHeight - margin;
    // A heading or "Label:" line travels with the next block.
    const next = introduces(el) ? nextVisible(el) : null;
    const withNext = next ? bottom(next) : 0;
    const end = next && withNext - start <= usable ? withNext : bottom(el);

    // Too tall for any page: cut into one piece per page, so its background
    // stops at the margin too.
    if (rect.height > usable) {
      if (isSplittable(el) || isTextBlock(el)) placeTall(el);
      return;
    }

    if (start < contentTop) moveTo(el, contentTop);
    else if (end > contentEnd) moveTo(el, contentTop + pageHeight);
  };

  const moveTo = (el: Element, target: number) => {
    const pageTop = Math.floor(top(el) / pageHeight) * pageHeight;
    const contentTop = pageTop + margin;
    // Take along introducing lines that would stay behind on this page.
    let anchor = el;
    if (target > pageTop + pageHeight - margin) {
      for (
        let prev = anchor.previousElementSibling;
        prev && introduces(prev) && top(prev) >= contentTop;
        prev = anchor.previousElementSibling
      ) {
        if (bottom(el) - top(prev) > usable) break;
        anchor = prev;
      }
    }

    const spacer = makeSpacer(doc);
    anchor.parentNode?.insertBefore(spacer, anchor);
    // Measured, not computed: the spacer breaks margin collapsing. Measured
    // with the spacer open, since an empty one lets margins collapse through.
    spacer.style.height = "1px";
    spacer.style.height = `${Math.max(0, target - top(anchor) + 1)}px`;
    inserted++;
  };

  const cut = (el: Element, limit: number): Element | null => {
    const style = getComputedStyle(el);
    const inner =
      limit -
      (parseFloat(style.paddingBottom) || 0) -
      (parseFloat(style.borderBottomWidth) || 0);
    if (isTextBlock(el)) {
      const at = textBreak(el, inner, scrollTop());
      return at && splitBefore(el, ...at);
    }
    // A table is cut between its body rows - never right after its header.
    const units =
      el.tagName === "TABLE"
        ? Array.from(el.querySelectorAll(":scope > tbody > tr")).filter(
            (row) => row !== headerRow(el),
          )
        : Array.from(el.children);
    let at = units.find(
      (unit) =>
        bottom(unit) + (parseFloat(getComputedStyle(unit).marginBottom) || 0) >
        inner,
    );
    if (!at) return null;
    if (
      at.getBoundingClientRect().height > usable &&
      (isSplittable(at) || isTextBlock(at))
    )
      at = cut(at, inner) ?? at;
    // A heading or label line goes on with the block it introduces.
    while (at.previousElementSibling && introduces(at.previousElementSibling))
      at = at.previousElementSibling;
    return at === units[0] ? null : splitBefore(el, at);
  };

  // A piece in the top margin band moves down to the text; one that can't
  // keep even its first line on this page moves to the next.
  const placeTall = (el: Element) => {
    let pageTop = Math.floor(top(el) / pageHeight) * pageHeight;
    if (top(el) < pageTop + margin) moveTo(el, pageTop + margin);
    let rest = cut(el, pageTop + pageHeight - margin);
    if (!rest) {
      pageTop += pageHeight;
      moveTo(el, pageTop + margin);
      rest = cut(el, pageTop + pageHeight - margin);
    }
    if (rest) place(rest);
  };

  for (const child of Array.from(root.children)) place(child);

  // Fill the last sheet to an exact page multiple, or it ends in a white
  // band.
  const body = doc.body;
  const height = doc.documentElement.scrollHeight;
  const fill = Math.ceil(height / pageHeight) * pageHeight - height;
  if (fill > 0) {
    const tail = doc.createElement("div");
    tail.className = SPACER_CLASS;
    tail.setAttribute("aria-hidden", "true");
    tail.style.cssText = `height:${fill}px`;
    body.appendChild(tail);
  }
  return inserted;
}

/**
 * Lays `html` out in a hidden frame at the paper width and paginates it. The
 * app's webview is the same engine as the print view, so heights match.
 */
export async function paginateHtml(
  html: string,
  page: PageGeometry,
): Promise<string> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-${page.width * 4}px;top:0;width:${page.width}px;height:${page.height}px;border:0;visibility:hidden;pointer-events:none`;
  try {
    const loaded = new Promise<void>((resolve) => {
      frame.onload = () => resolve();
    });
    frame.srcdoc = html;
    document.body.appendChild(frame);
    await loaded;
    const doc = frame.contentDocument;
    if (!doc) return html;
    try {
      await doc.fonts.ready;
    } catch {
      // Font loading API unavailable - lay out with what is loaded.
    }
    await Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete ? Promise.resolve() : img.decode().catch(() => undefined),
      ),
    );
    const root =
      doc.querySelector(".milkdown .ProseMirror") ??
      doc.querySelector(".milkdown");
    if (!root) return html;
    paginateDocument(doc, root, page.height, page.margin);
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  } finally {
    frame.remove();
  }
}
