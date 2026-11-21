// @vitest-environment jsdom
import { spawnSync } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { renderMarkdownHtml } from "../markdown/render-html";
import { toPandocMarkdown } from "../../export/pandoc-markdown";
import { loadKatex } from "./katex-loader";

afterEach(closeViews);
beforeAll(() => loadKatex());

/** Each line and the formulas in it: the editor, the chat and Pandoc (on
 *  what the export hands it) must all find these. */
const CASES: [string, string[]][] = [
  ["costs $5, a $x$ thing", ["x"]],
  ["$x$5", []],
  ["$x $y$", ["y"]],
  ["a $`x^2`$ b", ["x^2"]],
  ["$`x`$5 items", ["x"]],
  ["a $`b` c$ d", []],
  ["costs $`5` now", []],
  ["\\$$5 and $x$", ["x"]],
  ["\\$$`y`$ z", ["y"]],
  ["\\\\$x$", ["x"]],
];

// The reader the export runs (commands/export.rs).
const PANDOC_FROM =
  "commonmark_x-smart-subscript-superscript-fancy_lists-definition_lists" +
  "-fenced_divs-implicit_header_references+autolink_bare_uris";
const pandoc = spawnSync("pandoc", ["--version"]).status === 0;

/** Pandoc's inline formulas in `markdown`, as its native output lists them. */
function pandocFormulas(markdown: string): string[] {
  const out = spawnSync("pandoc", ["-f", PANDOC_FROM, "-t", "json"], {
    input: markdown,
    encoding: "utf8",
  }).stdout;
  const found: string[] = [];
  JSON.parse(out, (_key, value: unknown) => {
    const node = value as { t?: string; c?: [{ t: string }, string] };
    if (node?.t === "Math" && node.c?.[0].t === "InlineMath")
      found.push(node.c[1]);
    return value;
  });
  return found;
}

describe("which dollar opens inline math", () => {
  it.each(CASES)("in the editor: %s", async (source, expected) => {
    const t = await openView(source);
    const found = [
      ...t.view.dom.querySelectorAll('[data-type="math_inline"]'),
    ].map((el) => el.textContent);
    expect(found).toEqual(expected);
    expect(t.markdown()).toBe(source);
  });

  it.each(CASES)("in the chat: %s", (source, expected) => {
    // The formula's source is the MathML's last text (its annotation's).
    const page = new DOMParser().parseFromString(
      renderMarkdownHtml(source),
      "text/html",
    );
    const found = [...page.querySelectorAll(".katex-mathml math")].map(
      (math) => math.lastChild?.textContent,
    );
    expect(found).toEqual(expected);
  });

  it.runIf(pandoc).each(CASES)("in Pandoc's export: %s", (source, expected) => {
    expect(pandocFormulas(toPandocMarkdown(source))).toEqual(expected);
  });
});
