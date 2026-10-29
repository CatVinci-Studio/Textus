// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { moveBlock } from "./move-block-plugin";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function openAt(markdown: string, caretIn: string, to?: string) {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const view: EditorView = ctx.get(editorViewCtx);
    const find = (text: string) => {
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at < 0 && node.isText && node.text!.includes(text))
          at = pos + node.text!.indexOf(text) + 1;
      });
      return at;
    };
    const from = find(caretIn);
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, from, to ? find(to) : from),
      ),
    );
    const move = (direction: -1 | 1) =>
      moveBlock(direction)(view.state, view.dispatch);
    const save = () => ctx.get(serializerCtx)(view.state.doc);
    const caretText = () => view.state.selection.$from.parent.textContent;
    return { move, save, caretText };
  });
}

describe("moving a block", () => {
  it("trades a paragraph with its neighbours, caret along", async () => {
    const { move, save, caretText } = await openAt(
      "one\n\ntwo\n\nthree\n",
      "two",
    );
    expect(move(-1)).toBe(true);
    expect(save()).toBe("two\n\none\n\nthree\n");
    expect(caretText()).toBe("two");
    expect(move(-1)).toBe(false);
    move(1);
    move(1);
    expect(save()).toBe("one\n\nthree\n\ntwo\n");
    expect(move(1)).toBe(false);
  });

  it("moves a list item within its list, nested items with it", async () => {
    const { move, save } = await openAt("- a\n- b\n  - b1\n- c\n", "b");
    move(1);
    expect(save()).toBe("- a\n- c\n- b\n  - b1\n");
  });

  it("moves every block the selection spans", async () => {
    const { move, save } = await openAt(
      "one\n\ntwo\n\nthree\n",
      "two",
      "three",
    );
    move(-1);
    expect(save()).toBe("two\n\nthree\n\none\n");
  });
});
