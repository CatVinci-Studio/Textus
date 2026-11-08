// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { createTestEditor } from "../../document-view/editor-test-harness";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** Opens `markdown`; for each [anchor, text] step puts the caret at the
 *  end of the first textblock reading exactly `anchor` and types `text`
 *  one character at a time; then saves. */
async function typeAt(
  markdown: string,
  ...steps: [anchor: string, text: string][]
): Promise<string> {
  return typeIn(markdown, "end", steps);
}

/** As typeAt, the caret at the start of the textblock instead. */
function typeBefore(markdown: string, anchor: string, text: string) {
  return typeIn(markdown, "start", [[anchor, text]]);
}

async function typeIn(
  markdown: string,
  where: "start" | "end",
  steps: [anchor: string, text: string][],
): Promise<string> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    for (const [anchor, text] of steps) {
      let end = -1;
      view.state.doc.descendants((node, pos) => {
        if (end < 0 && node.isTextblock && node.textContent === anchor)
          end = where === "end" ? pos + node.nodeSize - 1 : pos + 1;
      });
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
      );
      for (const ch of text) {
        const { from, to } = view.state.selection;
        const handled = view.someProp("handleTextInput", (f) =>
          f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
        );
        if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
      }
    }
    return ctx.get(serializerCtx)(view.state.doc);
  });
}

describe("typing a task spelling", () => {
  it("turns a paragraph into a task", async () => {
    const out = await typeAt("", ["", "-[]x"]);
    expect(out).toBe("* [ ] x\n");
  });

  it("turns a line with words already in it into a task, the words its text", async () => {
    expect(await typeBefore("买牛奶\n", "买牛奶", "-[]")).toBe(
      "* [ ] 买牛奶\n",
    );
    expect(await typeBefore("Buy **milk**\n", "Buy milk", "-[x]")).toBe(
      "* [x] Buy **milk**\n",
    );
    expect(await typeBefore("买牛奶\n", "买牛奶", "- 【】")).toBe(
      "* [ ] 买牛奶\n",
    );
  });

  it("turns a list item with words in it into a task", async () => {
    expect(await typeBefore("* 买牛奶\n", "买牛奶", "[]")).toBe(
      "* [ ] 买牛奶\n",
    );
  });

  it("leaves a table cell's text alone instead of splitting the table", async () => {
    const table = "| a | b |\n| - | - |\n|   | 2 |\n";
    const out = await typeAt(table, ["", "-[]"]);
    expect(out).not.toContain("[ ]");
    expect(out.match(/\| a/g)).toHaveLength(1);
    expect(out).toMatch(/\| -\\?\[\] *\| 2 \|/);
  });

  it("eats the space of [ ] only where the task was just made", async () => {
    const out = await typeAt(
      "* \\[\n\nnext\n",
      ["[", "]"],
      ["next", " a"],
      ["", "milk"],
    );
    expect(out).toBe("* [ ] milk\n\nnext a\n");
  });
});
