// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../editor/editor-test-kit";
import { parseHeadings } from "./outline-parse";

// The Outline lists headings read from the Markdown, and a row's jump goes
// to the editor's n-th top-level heading (revealNthHeading): the two lists
// must be the same, or every row after a stray one lands on the next.
const ISSUE_MATH = [
  "$$",
  "\\mathcal S_v=(a_{v,k})_{k=1}^{n_v},",
  "\\qquad",
  "a_{v,k}=(c_{i_k},d_{v,k},\\phi(w_{v,k})).",
  "\\tag{4-2}",
  "$$",
].join("\n");

const CASES: Record<string, string> = {
  "the issue's formula": `# H1\n\n${ISSUE_MATH}\n\n# H2\n\n# H3`,
  "a formula with a line of only =": `# H1\n\n$$\n\\mathcal L_{\\mathrm{GRU}}\n=\n-\\frac{1}{3}\n\\tag{4-5}\n$$\n\n# H2\n\n## H3`,
  "a formula with a line of only -": `# H1\n\n$$\na\n-\nb\n$$\n\n# H2`,
  "a formula with a # line": `# H1\n\n$$\na\n# b\n$$\n\n# H2`,
  "a one-line formula": `# H1\n\n$$x = 1$$\n\n# H2`,
  "a loose formula": `# H1\n\n$$a\n=\nb$$\n\n# H2`,
  "a formula in a list": `# H1\n\n- $$\n  a\n  =\n  $$\n\n# H2`,
  "a formula in a quote": `# H1\n\n> $$\n> a\n> =\n> $$\n\n# H2`,
  "inline maths over ===": `# H1\n\n$$x$$\n===\n\n# H2`,
  "a $$ line holding inline maths, never closed": `# H1\n\n$$x$$ is famous\n\n# H2`,
  "a $$ line holding inline maths, closed later": `# H1\n\n$$x$$ is\n=\nb$$\n\n# H2`,
  "code, front matter and a comment": `---\n# yaml\n---\n# H1\n\n\`\`\`sh\n# not a heading\n\`\`\`\n\n<!--\n# old\n-->\n\nText\n===\n\n# H2`,
  // HTML blocks end as CommonMark says: at their closing tag, or at a
  // blank line; a `# x` line inside one is HTML.
  "a <div> without blank lines": `# H1\n\n<div>\n# no\n</div>\n\n# H2`,
  "a <div> with blank lines": `<div>\n\n# H1\n\n</div>\n\n# H2`,
  "a <details>": `<details>\n<summary>S</summary>\n# no\n</details>\n\n<details>\n<summary>S</summary>\n\n# H1\n\n</details>\n\n# H2`,
  "a <pre> across a blank line": `<pre>\n# no\n\n# no\n</pre>\n\n# H2`,
  "a <script> and a <style>": `<script>\n# no\n\n# no\n</script>\n\n<style>\n# no\n\n</style>\n# H2`,
  "a comment across a blank line": `<!--\n# no\n\n# no\n-->\n# H2`,
  "a <table>": `<table>\n<tr><td>\n# no\n</td></tr>\n</table>\n\n# H2`,
  "a custom element": `<my-el>\n# no\n</my-el>\n\n# H2`,
  "an inline tag under text": `Text\n<span>\n# H1`,
  // A fence or formula an item or quote opened ends with it.
  "a fence left open in a quote": `> \`\`\`\n> # no\n\n# H2`,
  "a fence left open in a list item": `- \`\`\`\n  # no\n\n# H2`,
  "a formula left open in a quote": `> $$\n> a\n\n# H2`,
  "a formula left open in a list item": `- $$\n  a\n\n# H2`,
  "a fence an item opened, then a line out of it": `# H1\n- x\n  \`\`\`\n# H2\n  \`\`\`\n## no`,
  // Nothing in a quote, list item or footnote is top-level.
  "a heading in a list item": `- a\n\n  # no\n\n1. a\n\n   ## no\n\n## H2`,
  "a setext heading in a list item": `- a\n  no\n  ---\n\n# H2`,
  "a lazy line in a quote over ===": `> a\nno\n===\n\n# H2`,
  "a quote over a rule": `> a\n---\n\n# H2`,
  "a list closed by a heading": `- a\n# H1\n  # H2`,
  "a footnote over a rule": `[^1]: no\n---\n\n# H2\n\nT[^1]`,
  "a footnote's indented heading": `[^1]: note\n\n    # no\n\n# H2\n\nT[^1]`,
  // No setext heading from code, a definition or a table.
  "indented code over a rule": `    no\n---\n# H2`,
  "a link definition over === and ---": `[a]: http://x\n===\n\n[b]: http://y\n---\n\n# H2`,
  "a link definition, then text over ===": `[a]: http://x\nText\n===\n\n# H2`,
  "a table over a rule": `a | b\n--- | ---\nno | d\n---\n\n| a | b |\n| - | - |\n| no | d |\n===\n\n# H2`,
  "a paragraph's lines over ===": `H1\nH1b\n===\n\n# H2`,
  "a numbered line under text, which starts no list": `H1\n2. H1b\n===\n\n# H2`,
  "indented text under a paragraph": `Text\n    # no\n# H2`,
  // Tabs count in columns, to the next multiple of four.
  "tabs after quote and list marks": `>\t# no\n\n-\t# no\n\n- a\n\n\t# no\n\n1.\ta\n\n \t# no\n\n# H2`,
  "a tab-indented fence in a list item": `- a\n\n\t\`\`\`\n\t# no\n\t\`\`\`\n\nText\n \t===\n\n# H2`,
  // A loose formula's close must come before its container ends.
  "a $$ line with inline maths in a quote, closed outside it": `> $$x$$ is\nno\n===\n\n$$\na\n$$\n\n# H2`,
  "a $$ line with inline maths in a list item, closed outside it": `- $$x$$ is\nno\n===\n\n$$\na\n$$\n\n# H2`,
  // A list item can start with one blank line, not two.
  "an empty list item, then a blank line": `# H1\n\n-\n\n  # H2`,
  "an empty list item, then a blank line and a setext heading": `-\n\n  H1\n  ---\n\n# H2`,
  "an empty list item, then its text": `-\n  no\n  ---\n\n# H2`,
  // A definition's destination, title or label may wrap.
  "a link definition whose title wraps": `[a]: http://x\n"title"\n===\n\n[b]:\nhttp://x\n'ti\ntle'\n===\n\n# H2`,
  "a link definition whose destination or label wraps": `[a]:\nhttp://x\n===\n\n[a\nb]: http://x\n---\n\n# H2`,
  "a link definition with words after its title": `[a]: http://x\n"H1" junk\n===\n\n# H2`,
};

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

async function editorHeadings(markdown: string): Promise<string[]> {
  editor = await createTestEditor(markdown);
  const out: string[] = [];
  editor.ctx.get(editorViewCtx).state.doc.forEach((node) => {
    if (node.type.name === "heading")
      out.push(`${node.attrs.level as number} ${node.textContent}`);
  });
  return out;
}

describe("the Outline's headings are the editor's", () => {
  it.each(Object.entries(CASES))("%s", async (_name, markdown) => {
    // A formula's source as the outline has it, its text as the editor does.
    const outline = parseHeadings(markdown).map(
      (h) => `${h.level} ${h.text.replace(/\$/g, "")}`,
    );
    expect(outline).toEqual(await editorHeadings(markdown));
    // Only real headings: never a line of a formula, nor one named "no".
    expect(outline.every((h) => /^\d ("?H\d|Text|x)/.test(h))).toBe(true);
    expect(outline.some((h) => /\bno\b/.test(h))).toBe(false);
  });
});
