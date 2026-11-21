// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeViews, openView, type TestView } from "../editor-view-kit";
import { renderMarkdownHtml } from "../markdown/render-html";
import { toPandocMarkdown } from "../../export/pandoc-markdown";
import { loadKatex } from "./katex-loader";

afterEach(closeViews);
beforeAll(() => loadKatex());

const formulas = (t: TestView) =>
  [
    ...t.view.dom.querySelectorAll<HTMLElement>('[data-type="math_inline"]'),
  ].map((el) => `${el.dataset.delimiter ?? "$"} ${el.textContent}`);
const codes = (t: TestView) =>
  [...t.view.dom.querySelectorAll("code")].map((el) => el.textContent);

describe("GitHub's $`math`$", () => {
  it("reads as inline math and saves as written", async () => {
    const source = "a $`x^2`$ b and $`a$b\\c`$";
    const t = await openView(source);
    t.select(1);
    expect(formulas(t)).toEqual(["$` x^2", "$` a$b\\c"]);
    expect(t.markdown()).toBe(source);
  });

  it("is written in its own form again once the formula is edited", async () => {
    const t = await openView("a $`x^2`$ b");
    t.view.dispatch(t.view.state.tr.insertText("3", 6, 7));
    expect(formulas(t)).toEqual(["$` x^3"]);
    expect(t.markdown()).toBe("a $`x^3`$ b");
  });

  it("is drawn by KaTeX only while maths are on", async () => {
    const on = await openView("a $`x^2`$ b");
    on.select(1);
    expect(on.view.dom.querySelector(".katex")).not.toBeNull();
    const off = await openView("a $`x^2`$ b", { enableMath: false });
    off.select(1);
    expect(off.view.dom.querySelector(".katex")).toBeNull();
  });

  it("shows its own delimiters while the caret is inside", async () => {
    const t = await openView("a $`x`$ b");
    t.select(5);
    const shown = [...t.view.dom.querySelectorAll(".enclosure-delimiter")].map(
      (el) => el.textContent,
    );
    expect(shown).toEqual(["$`", "`$"]);
  });

  it.each(["costs $`5` now", "$`a` b `c`$", "`code`$ and $`x`"])(
    "leaves a dollar beside inline code as text: %s",
    async (source) => {
      const t = await openView(source);
      expect(formulas(t)).toEqual([]);
      expect(codes(t).length).toBeGreaterThan(0);
      expect(t.markdown()).toBe(source);
      expect(renderMarkdownHtml(source)).not.toContain("katex");
    },
  );

  it("exports a dollar beside inline code escaped, so Pandoc opens no math", () => {
    expect(toPandocMarkdown("a $`b` c$ d")).toBe("a \\$`b` c$ d");
    expect(toPandocMarkdown("`code`$ and $`x`")).toBe("`code`$ and \\$`x`");
    expect(toPandocMarkdown("\\$`b` c$")).toBe("\\$`b` c$");
  });

  it("renders in the chat as KaTeX, its backticks the delimiter", () => {
    const html = renderMarkdownHtml("a $`x^2`$ b");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("`");
  });

  it("exports to Pandoc as $...$, a dollar in it escaped", () => {
    expect(toPandocMarkdown("a $`x^2`$ b, $`a$b`$ and `$x$`")).toBe(
      "a $x^2$ b, $a\\$b$ and `$x$`",
    );
  });

  it("exports a formula Pandoc's $...$ can't close as Pandoc still reads it", () => {
    // Before a digit, an empty raw span lets the closing dollar close.
    expect(toPandocMarkdown("$`x`$5")).toBe("$x$` `{=textus}5");
    // A blank formula draws nothing; a lone backslash at the end would
    // escape the closer, so that one reads as written.
    expect(toPandocMarkdown("a $` `$ b")).toBe("a  b");
    expect(toPandocMarkdown("$`a\\`$ b $c$")).toBe("\\$\\`a\\\\\\`\\$ b $c$");
    expect(toPandocMarkdown("$`a\\\\`$")).toBe("$a\\\\$");
  });
});
