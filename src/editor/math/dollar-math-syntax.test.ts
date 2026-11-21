// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { renderMarkdownHtml } from "../markdown/render-html";
import { loadKatex } from "./katex-loader";

afterEach(closeViews);
beforeAll(() => loadKatex());

const formulas = async (source: string) => {
  const t = await openView(source);
  const found = [
    ...t.view.dom.querySelectorAll('[data-type="math_inline"]'),
  ].map((el) => el.textContent);
  return { found, saved: t.markdown() };
};

describe("single-dollar math, by Pandoc's rule", () => {
  it.each(["价格 $5 到 $10", "costs $5 and $10", "$ 5 $", "$x$5"])(
    "leaves %s as text, saved as written",
    async (source) => {
      expect(await formulas(source)).toEqual({ found: [], saved: source });
      expect(renderMarkdownHtml(source)).not.toContain("katex");
    },
  );

  it.each([
    ["$x$", ["x"]],
    ["$a+b$", ["a+b"]],
    ["$\\alpha$", ["\\alpha"]],
    ["$$x$$ and $5", ["x"]],
  ])("reads %s as math", async (source, expected) => {
    expect(await formulas(source)).toEqual({ found: expected, saved: source });
  });

  it.each([
    ["costs $5, a $x$ thing", ["x"]],
    ["$x $y$", ["y"]],
  ])(
    "reads the formula after a dollar that opens none, as the chat does: %s",
    async (source, expected) => {
      expect(await formulas(source)).toEqual({
        found: expected,
        saved: source,
      });
      expect(renderMarkdownHtml(source).match(/class="katex"/g)).toHaveLength(
        1,
      );
    },
  );

  it("keeps a formula in a table and a price beside it", async () => {
    const source = "| $|x|$ | b |\n|---|---|\n| $5 | $6 |";
    expect(await formulas(source)).toEqual({ found: ["|x|"], saved: source });
  });
});
