// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** Opens `markdown`, selects from `from` to `to` (offsets into the first
 *  paragraph) and presses Ctrl+`key`; what was saved and whether the
 *  shortcut took the key. */
async function pressOver(
  markdown: string,
  from: number,
  to: number,
  key = "b",
): Promise<{ saved: string; handled: boolean }> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const view: EditorView = ctx.get(editorViewCtx);
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 1 + from, 1 + to),
      ),
    );
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true });
    const handled = !!view.someProp("handleKeyDown", (f) => f(view, event));
    return { saved: ctx.get(serializerCtx)(view.state.doc), handled };
  });
}

describe("Ctrl+B and Ctrl+I over a selection", () => {
  // Offsets count a code span as its text plus two: "x a `b` c y" is
  // x(0) space(1) a(2) space(3) code(4-7) space(7) c(8) space(9) y(10).
  it("makes text with code in it bold", async () => {
    expect(await pressOver("x a `b` c y\n", 2, 9)).toEqual({
      saved: "x **a `b` c** y\n",
      handled: true,
    });
  });

  it("makes code alone italic", async () => {
    expect((await pressOver("x `b` y\n", 2, 5, "i")).saved).toBe("x *`b`* y\n");
  });

  it("leaves the spaces at the edges outside, not a code's own", async () => {
    expect((await pressOver("x  `b`  y\n", 1, 8)).saved).toBe(
      "x  **`b`**  y\n",
    );
    expect((await pressOver("x ` b` y\n", 1, 6)).saved).toBe("x **` b`** y\n");
  });

  it("makes text with maths in it bold", async () => {
    expect((await pressOver("x a $m$ y\n", 2, 7)).saved).toBe(
      "x **a $m$** y\n",
    );
  });

  it("leaves a selection with a span in it as it was", async () => {
    expect(await pressOver("x a *i* y\n", 2, 7)).toEqual({
      saved: "x a *i* y\n",
      handled: false,
    });
  });
});

describe("Ctrl+B and Ctrl+I on their own formatting", () => {
  // "a **bold** c": a(0) space(1) span(2), its text 3-7, after it 8.
  it("takes bold off around the caret", async () => {
    expect(await pressOver("a **bold** c\n", 4, 4)).toEqual({
      saved: "a bold c\n",
      handled: true,
    });
  });

  it("takes bold off a selection inside it or around it", async () => {
    expect((await pressOver("a **bold** c\n", 4, 6)).saved).toBe("a bold c\n");
    expect((await pressOver("a **bold** c\n", 2, 8)).saved).toBe("a bold c\n");
  });

  it("takes italic off with Ctrl+I", async () => {
    expect((await pressOver("a *it* c\n", 4, 4, "i")).saved).toBe("a it c\n");
  });

  it("keeps the italic half of bold-italic", async () => {
    expect((await pressOver("a ***bi*** c\n", 5, 5)).saved).toBe("a *bi* c\n");
  });
});
