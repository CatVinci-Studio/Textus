// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { paginateDocument, splitBefore } from "./paginate";

// jsdom has no layout, so blocks are given fixed heights and stacked:
// each block's rect is computed from its order and the spacers before it.
function stack(heights: number[]): {
  root: HTMLElement;
  blocks: HTMLElement[];
} {
  const root = document.createElement("div");
  const blocks = heights.map((h) => {
    const el = document.createElement("p");
    el.dataset.h = String(h);
    root.appendChild(el);
    return el;
  });
  document.body.replaceChildren(root);
  const heightOf = (el: Element) =>
    el.classList.contains("textus-page-spacer")
      ? parseFloat((el as HTMLElement).style.height) || 0
      : Number((el as HTMLElement).dataset.h ?? 0);
  for (const el of [root, ...blocks]) {
    el.getBoundingClientRect = function () {
      let top = 0;
      for (const sibling of Array.from(root.children)) {
        if (sibling === this) break;
        top += heightOf(sibling);
      }
      const height = this === root ? 0 : heightOf(this);
      return { top, bottom: top + height, height } as DOMRect;
    };
  }
  return { root, blocks };
}

describe("paginateDocument", () => {
  it("pushes a block that would cross a seam to the next page's margin", () => {
    // Page 100, margin 10: usable 10..90. The second block (60..100)
    // crosses the bottom band, so it must start at 110.
    const { root, blocks } = stack([60, 40]);
    paginateDocument(document, root, 100, 10);
    const spacers = root.querySelectorAll(".textus-page-spacer");
    expect(spacers).toHaveLength(2);
    expect(blocks[1].getBoundingClientRect().top).toBe(110);
  });

  it("moves a block out of a page's top margin band", () => {
    const { root, blocks } = stack([30]);
    paginateDocument(document, root, 100, 10);
    expect(blocks[0].getBoundingClientRect().top).toBe(10);
  });

  it("leaves a block taller than a page where it is", () => {
    const { root } = stack([300]);
    expect(paginateDocument(document, root, 100, 10)).toBe(0);
  });
});

// Block layout for nested elements: a leaf is as tall as its data-h, a
// container as its children together, stacked from the top of `root`.
function layOut(root: HTMLElement): void {
  const heightOf = (el: Element): number =>
    el.classList.contains("textus-page-spacer")
      ? parseFloat((el as HTMLElement).style.height) || 0
      : el.children.length
        ? Array.from(el.children).reduce((sum, c) => sum + heightOf(c), 0)
        : Number((el as HTMLElement).dataset.h ?? 0);
  const topOf = (el: Element): number => {
    if (el === root || !el.parentElement) return 0;
    let top = topOf(el.parentElement);
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling)
      top += heightOf(s);
    return top;
  };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const top = topOf(this);
      const height = this === root ? 0 : heightOf(this);
      return { top, bottom: top + height, height } as DOMRect;
    },
  );
}

describe("paginateDocument with blocks taller than a page", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cuts a quote taller than a page into one quote per page, clear of both margins", () => {
    // Page 100, margin 10: each page holds two 30px paragraphs.
    const root = document.createElement("div");
    root.innerHTML = `<blockquote>${'<p data-h="30"></p>'.repeat(5)}</blockquote>`;
    document.body.replaceChildren(root);
    layOut(root);
    paginateDocument(document, root, 100, 10);
    const quotes = Array.from(root.querySelectorAll("blockquote"));
    expect(quotes.map((q) => q.children.length)).toEqual([2, 2, 1]);
    expect(quotes.map((q) => q.getBoundingClientRect().top)).toEqual([
      10, 110, 210,
    ]);
  });

  it("cuts a table between body rows, never right after its header", () => {
    const root = document.createElement("div");
    const row = '<tr><td data-h="30"></td></tr>';
    root.innerHTML = `<table><tbody><tr><th data-h="30"></th></tr>${row.repeat(4)}</tbody></table>`;
    document.body.replaceChildren(root);
    layOut(root);
    paginateDocument(document, root, 100, 10);
    const tables = Array.from(root.querySelectorAll("table"));
    // A header and one row to a page, the header repeated on each.
    expect(tables.map((t) => t.rows.length)).toEqual([2, 2, 2, 2]);
    expect(tables.every((t) => t.rows[0].cells[0].tagName === "TH")).toBe(true);
  });
});

describe("splitBefore", () => {
  it("keeps code highlighting on both sides of a cut inside a span", () => {
    const pre = document.createElement("pre");
    pre.innerHTML =
      '<code><span class="token comment">/* one\ntwo */</span>\nthree</code>';
    document.body.replaceChildren(pre);
    const text = pre.querySelector("span")!.firstChild!;
    const rest = splitBefore(pre, text, "/* one\n".length);
    expect(pre.innerHTML).toBe(
      '<code><span class="token comment">/* one\n</span></code>',
    );
    expect(rest.outerHTML).toBe(
      '<pre><code><span class="token comment">two */</span>\nthree</code></pre>',
    );
  });

  it("goes on counting an ordered list", () => {
    const list = document.createElement("ol");
    list.start = 3;
    list.style.setProperty("--textus-ol-start", "2");
    list.innerHTML = "<li>a</li><li>b</li><li>c</li>";
    document.body.replaceChildren(list);
    const rest = splitBefore(list, list.children[2]) as HTMLOListElement;
    expect(rest.start).toBe(5);
    expect(rest.style.getPropertyValue("--textus-ol-start")).toBe("4");
    expect(rest.textContent).toBe("c");
  });

  it("repeats a table's column widths and header row", () => {
    const table = document.createElement("table");
    table.innerHTML =
      '<colgroup><col style="width: 30%"></colgroup><tbody><tr><th>h</th></tr><tr><td>1</td></tr><tr><td>2</td></tr></tbody>';
    document.body.replaceChildren(table);
    const rest = splitBefore(table, table.querySelectorAll("tr")[2]);
    expect(rest.innerHTML).toBe(
      '<colgroup><col style="width: 30%"></colgroup><tbody><tr><th>h</th></tr><tr><td>2</td></tr></tbody>',
    );
    expect(table.querySelectorAll("tr")).toHaveLength(2);
  });
});
