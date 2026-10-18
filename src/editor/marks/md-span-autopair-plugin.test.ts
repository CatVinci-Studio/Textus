// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { convertRunClosedBeforeCaret } from "./md-span-autopair-plugin";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function openView(markdown = ""): Promise<{
  view: EditorView;
  save: () => string;
}> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    return { view, save: () => ctx.get(serializerCtx)(view.state.doc) };
  });
}

/** What an IME commit leaves behind: the composed text inserted at the
 *  caret with no handleTextInput call. */
function commit(view: EditorView, text: string): void {
  const { from, to } = view.state.selection;
  view.dispatch(view.state.tr.insertText(text, from, to));
}

function caretToEndOfFirstBlock(view: EditorView): void {
  let end = -1;
  view.state.doc.descendants((node, pos) => {
    if (end < 0 && node.isTextblock) end = pos + node.nodeSize - 1;
  });
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
  );
}

describe("delimiters committed by an IME (#134)", () => {
  it("turns **text** committed one * at a time into bold", async () => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    for (const piece of ["*", "*", "加粗文本", "*"]) {
      commit(view, piece);
      expect(convertRunClosedBeforeCaret(view, piece)).toBe(false);
    }
    commit(view, "*");
    expect(convertRunClosedBeforeCaret(view, "*")).toBe(true);
    expect(save()).toBe("**加粗文本**\n");
    // The caret sits after the new node, so typing continues outside it.
    commit(view, "后");
    expect(save()).toBe("**加粗文本**后\n");
  });

  it("converts a whole span committed at once", async () => {
    const { view, save } = await openView("前");
    caretToEndOfFirstBlock(view);
    commit(view, "*斜体*");
    expect(convertRunClosedBeforeCaret(view, "*斜体*")).toBe(true);
    expect(save()).toBe("前*斜体*\n");
  });

  it("handles strikethrough, highlight and bold-italic the same way", async () => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    for (const span of ["~~删除~~", "==高亮==", "***都有***"]) {
      commit(view, span);
      expect(convertRunClosedBeforeCaret(view, span)).toBe(true);
    }
    expect(save()).toBe("~~删除~~==高亮==***都有***\n");
  });

  it("leaves an unpaired or still-growing run literal", async () => {
    const { view } = await openView();
    caretToEndOfFirstBlock(view);
    commit(view, "a * b *");
    // "* b *" has whitespace at its edges, which no span may have.
    expect(convertRunClosedBeforeCaret(view, "*")).toBe(false);
    commit(view, " ~x~");
    // A single "~" is not strikethrough.
    expect(convertRunClosedBeforeCaret(view, "~")).toBe(false);
  });

  it("doesn't convert a closing run the commit didn't end with", async () => {
    const { view } = await openView();
    caretToEndOfFirstBlock(view);
    commit(view, "**粘贴**");
    expect(convertRunClosedBeforeCaret(view, "你好")).toBe(false);
  });

  it("runs on its own after compositionend", async () => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    commit(view, "**加粗文本**");
    view.dom.dispatchEvent(
      new CompositionEvent("compositionend", { data: "*" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe("md_span");
    expect(save()).toBe("**加粗文本**\n");
  });
});
