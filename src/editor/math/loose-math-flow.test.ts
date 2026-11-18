// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { createTestEditor } from "../editor-test-kit";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** `markdown` read: its blocks as "type:text", and the save. */
async function read(markdown: string) {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const blocks: string[] = [];
    view.state.doc.descendants((node) => {
      if (node.isTextblock)
        blocks.push(`${node.type.name}:${node.textContent}`);
      return !node.isTextblock;
    });
    return { blocks, saved: ctx.get(serializerCtx)(view.state.doc) };
  });
}

describe("display maths written loosely", () => {
  it("keeps a formula begun on the $$ line", async () => {
    const { blocks, saved } = await read("$$x = 1\ny = 2\n$$\n\nafter\n");
    expect(blocks).toEqual(["math_block:x = 1\ny = 2", "paragraph:after"]);
    expect(saved).toBe("$$\nx = 1\ny = 2\n$$\n\nafter\n");
  });

  it("ends a formula at a $$ after its last line, not at the document's end", async () => {
    expect((await read("$$\na\nb$$\nafter\n")).blocks).toEqual([
      "math_block:a\nb",
      "paragraph:after",
    ]);
    expect(
      (await read("$$\\begin{aligned}\na &= b\n\\end{aligned}$$\n\nafter\n"))
        .blocks,
    ).toEqual([
      "math_block:\\begin{aligned}\na &= b\n\\end{aligned}",
      "paragraph:after",
    ]);
  });

  it("reads one in a list and in a quote", async () => {
    expect((await read("- item\n\n  $$x\n  y$$\n\nafter\n")).blocks).toEqual([
      "paragraph:item",
      "math_block:x\ny",
      "paragraph:after",
    ]);
    expect((await read("> $$a\n> b$$\n\nafter\n")).blocks).toEqual([
      "math_block:a\nb",
      "paragraph:after",
    ]);
  });

  it("leaves a fenced formula, $$x$$ on one line and an escaped dollar as they were", async () => {
    expect((await read("$$\nx\n$$\n")).saved).toBe("$$\nx\n$$\n");
    expect((await read("$$x = 1$$\n")).saved).toBe("$$x = 1$$\n");
    expect((await read("$$\na \\$$\nb\n$$\n")).blocks).toEqual([
      "math_block:a \\$$\nb",
    ]);
  });
});
