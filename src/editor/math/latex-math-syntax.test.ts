// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { parseMarkdownSource } from "../markdown/parse-markdown-source";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function open(markdown: string) {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const math: string[] = [];
    view.state.doc.descendants((node) => {
      if (node.type.name === "math_inline" || node.type.name === "math_block")
        math.push(`${node.type.name}:${node.textContent}`);
    });
    return {
      view,
      math,
      save: () => ctx.get(serializerCtx)(view.state.doc),
    };
  });
}

/** Opens `markdown`, adds a paragraph "!" above it (an edit, so the file
 *  is written out rather than kept as it was opened), and saves it. */
async function editAndSave(markdown: string): Promise<string> {
  const { view, save } = await open(markdown);
  const { schema } = view.state;
  view.dispatch(
    view.state.tr.insert(
      0,
      schema.nodes.paragraph.create(null, schema.text("!")),
    ),
  );
  return save();
}

describe("LaTeX math delimiters in a file", () => {
  it.each([
    ["inline", "a \\(x^2\\) b", ["math_inline:x^2"]],
    ["inline with spaces kept", "a \\( x \\) b", ["math_inline: x "]],
    ["display inside a paragraph", "a \\[x\\] b", ["math_inline:x"]],
    ["display alone on a line", "\\[x = 1\\]", ["math_block:x = 1"]],
    ["display on lines of its own", "\\[\nx = 1\n\\]", ["math_block:x = 1"]],
    [
      "display between lines of text",
      "a\n\\[\nx\n\\]\nb",
      ["math_inline:\nx\n"],
    ],
    ["display in a list item", "- \\[x\\]", ["math_block:x"]],
    [
      "a LaTeX command inside",
      "\\(\\frac{a}{b} \\\\ c\\)",
      ["math_inline:\\frac{a}{b} \\\\ c"],
    ],
    [
      "two in one line",
      "\\(a\\) and \\(b\\)",
      ["math_inline:a", "math_inline:b"],
    ],
  ])("reads %s as math", async (_name, markdown, math) => {
    expect((await open(markdown)).math).toEqual(math);
  });

  it.each([
    ["a citation", "see \\[1\\]"],
    ["a citation list", "see \\[2, 3\\]"],
    ["a citation range", "see \\[4-6\\]"],
    ["a fenced code block", "```\n\\(x\\)\n```"],
    ["a tilde code block", "~~~\n\\[x\\]\n~~~"],
    ["an indented code block", "    \\(x\\)"],
    ["inline code", "`\\(x\\)` here"],
    ["a pair across a code span", "\\( a `b \\)` c"],
    ["a pair across paragraphs", "\\(a\n\nb\\)"],
    ["a pair across a blank line", "\\[\nx\n\n\\]"],
    ["an escaped backslash", "\\\\(x\\\\)"],
  ])("leaves %s as text", async (_name, markdown) => {
    expect((await open(markdown)).math).toEqual([]);
  });

  it.each([
    ["inline", "a \\(x^2\\) b\n"],
    ["inline with spaces", "a \\( x \\) b\n"],
    ["display inside a paragraph", "a \\[x\\] b\n"],
    ["display alone on a line", "\\[x = 1\\]\n"],
    ["display on lines of its own", "\\[\nx = 1\n\\]\n"],
    ["display in a quote", "> \\[\n> x\n> \\]\n"],
    ["display between lines of text", "a\n\\[\nx\n\\]\nb\n"],
    ["a multi-line formula", "\\[\na \\\\\nb\n\\]\n"],
    [
      "both kinds with dollars",
      "$a$ \\(b\\) $$c$$\n\n$$\nd\n$$\n\n\\[\ne\n\\]\n",
    ],
  ])("writes %s back as it was after an edit", async (_name, markdown) => {
    const saved = await editAndSave(markdown);
    expect(saved).toBe(`!\n\n${markdown}`);
  });

  it("writes a citation back as an escaped bracket, still text", async () => {
    expect(await editAndSave("see \\[1\\]\n")).toBe("!\n\nsee \\[1]\n");
  });

  it("shows the delimiters the formula was written with", async () => {
    const { view } = await open("a \\(x\\) b\n");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)),
    );
    const shown = [...view.dom.querySelectorAll(".enclosure-delimiter")].map(
      (el) => el.textContent,
    );
    expect(shown).toEqual(["\\(", "\\)"]);
  });

  it("still turns pasted LaTeX maths into dollars", async () => {
    const editor = await createTestEditor("");
    editors.push(editor);
    const saved = editor.action((ctx) => {
      const doc = parseMarkdownSource(ctx, "a \\(x\\) b\n\n\\[y\\]\n");
      return doc && ctx.get(serializerCtx)(doc);
    });
    expect(saved).toBe("a $x$ b\n\n$$\ny\n$$\n");
  });

  it("writes math the editor makes in dollars", async () => {
    const { view, save } = await open("\\(a\\)\n");
    const type = view.state.schema.nodes.math_inline;
    view.dispatch(
      view.state.tr.insert(
        view.state.doc.content.size - 1,
        type.create({}, view.state.schema.text("b")),
      ),
    );
    expect(save()).toBe("\\(a\\)$b$\n");
  });

  it("falls back to dollars when the formula no longer fits", async () => {
    const { view, save } = await open("a \\(x\\) b\n");
    let pos = -1;
    view.state.doc.descendants((node, p) => {
      if (node.type.name === "math_inline") pos = p + 1;
    });
    // A closer typed inside would end the formula early.
    view.dispatch(view.state.tr.insertText("\\)", pos + 1));
    expect(save()).toBe("a $x\\)$ b\n");
  });
});
