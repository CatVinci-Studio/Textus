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
    // Only real headings: never a line of a formula.
    expect(outline.every((h) => /^\d (H\d|Text|x)$/.test(h))).toBe(true);
  });
});
