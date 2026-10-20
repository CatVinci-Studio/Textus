// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  katexLoaded,
  loadKatex,
  mayHaveMath,
  mathSourceHtml,
  onKatexReady,
} from "./katex-loader";
import { renderMarkdownHtml } from "../markdown/render-html";

describe("KaTeX on demand", () => {
  it("shows a formula's source until KaTeX has loaded, then draws it", async () => {
    expect(katexLoaded()).toBe(false);
    const ready = vi.fn();
    onKatexReady(ready);
    // The first formula starts the load.
    expect(renderMarkdownHtml("$a<b$")).toContain(
      '<code class="math-pending">a&lt;b</code>',
    );
    await loadKatex();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(katexLoaded()).toBe(true);
    expect(renderMarkdownHtml("$a<b$")).toContain('class="katex"');
  });

  it("escapes the source it shows", () => {
    expect(mathSourceHtml("<i>&")).toBe(
      '<code class="math-pending">&lt;i&gt;&amp;</code>',
    );
  });

  it("looks for maths in each way a formula is written", () => {
    expect(mayHaveMath("Energy $E=mc^2$")).toBe(true);
    expect(mayHaveMath("\\(x\\) and \\[y\\]")).toBe(true);
    expect(mayHaveMath("# Notes\n\nNo formulas here.")).toBe(false);
  });
});
