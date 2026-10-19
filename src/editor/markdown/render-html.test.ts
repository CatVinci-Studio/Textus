// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { renderDocumentHtml, renderMarkdownHtml } from "./render-html";
import { loadKatex } from "../math/katex-loader";

// KaTeX is loaded on first use in the app; these tests render with it.
beforeAll(() => loadKatex());

describe("renderMarkdownHtml", () => {
  it("renders inline and display math with KaTeX", () => {
    const html = renderMarkdownHtml("Energy $E=mc^2$.\n\n$$\\frac13$$");
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="agent-math"');
    expect(html).toContain("katex-display");
  });

  it("renders LaTeX's own delimiters too", () => {
    expect(renderMarkdownHtml("so \\(x^2\\) holds")).toContain('class="katex"');
  });

  it("leaves dollar amounts as text", () => {
    const html = renderMarkdownHtml("costs $5 and $10 today");
    expect(html).not.toContain("katex");
    expect(html).toContain("$5 and $10");
  });

  it("renders GFM tables and task lists", () => {
    const html = renderMarkdownHtml(
      "| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] done",
    );
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
  });

  it("still strips script from model output", () => {
    expect(renderMarkdownHtml("<img src=x onerror=alert(1)>")).not.toContain(
      "onerror",
    );
  });

  it("renders a $$ block written inside a list item without blank lines", () => {
    const html = renderMarkdownHtml(
      "- 法向量由梯度给出：\n  $$\n  \\nabla f=\\left(\\frac{\\partial f}{\\partial x}\\right)\n  $$\n- 下一条",
    );
    expect(html).not.toContain("$$");
    expect(html).toContain("katex-display");
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it("renders a $$ block that follows a paragraph line directly", () => {
    const html = renderMarkdownHtml("梯度：\n$$\nx^2\n$$\n结束");
    expect(html).not.toContain("$$");
    expect(html).toContain("katex-display");
  });
});

describe("renderDocumentHtml", () => {
  it("shows an empty-text link's URL", () => {
    expect(renderDocumentHtml("see [](https://x.org/a) here")).toContain(
      '<a href="https://x.org/a">https://x.org/a</a>',
    );
    expect(renderDocumentHtml("[text](https://x.org/a)")).toContain(
      '<a href="https://x.org/a">text</a>',
    );
  });
});

describe("before KaTeX has loaded", () => {
  it("shows a formula's source rather than dropping it", async () => {
    const { mathSourceHtml } = await import("../math/katex-loader");
    expect(mathSourceHtml("a<b")).toBe(
      '<code class="math-pending">a&lt;b</code>',
    );
  });
});
