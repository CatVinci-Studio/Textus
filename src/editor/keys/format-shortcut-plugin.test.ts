// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { AllSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../editor-test-kit";

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

  it("keeps another style nested inside the new span", async () => {
    expect(await pressOver("x a *i* y\n", 2, 7)).toEqual({
      saved: "x **a *i*** y\n",
      handled: true,
    });
  });

  // "a **b** c **d** e": a(0) sp(1) span(2-5) sp(5) c(6) sp(7) span(8-11) sp(11) e(12).
  it("merges bold already in the selection into one span", async () => {
    expect((await pressOver("a **b** c **d** e\n", 0, 13)).saved).toBe(
      "**a b c d e**\n",
    );
  });

  it("takes in all of a bold the selection cuts", async () => {
    // From inside the first bold (its "b") to the "c" after it.
    expect((await pressOver("a **bb** c\n", 4, 9)).saved).toBe("a **bb c**\n");
  });

  it("takes in a bold-italic the selection reaches into", async () => {
    // "a ***bc*** d" loads as italic around bold: "a b" selected.
    expect((await pressOver("a ***bc*** d\n", 0, 4)).saved).toBe(
      "**a *bc*** d\n",
    );
  });

  it("keeps the other half of bold-italic inside", async () => {
    expect((await pressOver("a ***b*** c\n", 0, 9)).saved).toBe(
      "**a *b* c**\n",
    );
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

/** Opens `markdown`, selects all of it as Select All does, presses
 *  Ctrl+`key` `times` times; what was saved after each press. */
async function pressOverAll(
  markdown: string,
  key: string,
  times: number,
): Promise<string[]> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const view: EditorView = ctx.get(editorViewCtx);
    const saved: string[] = [];
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
    for (let i = 0; i < times; i++) {
      const event = new KeyboardEvent("keydown", { key, ctrlKey: true });
      view.someProp("handleKeyDown", (f) => f(view, event));
      saved.push(ctx.get(serializerCtx)(view.state.doc));
    }
    return saved;
  });
}

describe("Ctrl+B and Ctrl+` on a selection with one end inside the span", () => {
  // "a **bc** d": a(0) space(1) bold(2-6), its text 3-5.
  it.each([
    [2, 5],
    [3, 6],
  ])("takes bold off %i-%i", async (from, to) => {
    expect((await pressOver("a **bc** d\n", from, to)).saved).toBe("a bc d\n");
  });

  // "x `co` y": x(0) space(1) code(2-6), its text 3-5.
  it.each([
    [2, 5],
    [3, 6],
  ])("takes code off %i-%i", async (from, to) => {
    expect((await pressOver("x `co` y\n", from, to, "`")).saved).toBe(
      "x co y\n",
    );
  });
});

it("keeps Ctrl+B from the browser where it can't apply", async () => {
  // "x *ab* cd": the selection "b c" crosses the italic's end.
  const { saved, handled } = await pressOver("x *ab* cd\n", 4, 8);
  expect(handled).toBe(true);
  expect(saved).toBe("x *ab* cd\n");
});

describe("Ctrl+B and Ctrl+I over several blocks", () => {
  it("formats each block's text after Select All, and takes it off again", async () => {
    const [on, off] = await pressOverAll(
      "One line\n\nTwo lines\n\n```\ncode\n```\n",
      "b",
      2,
    );
    expect(on).toBe("**One line**\n\n**Two lines**\n\n```\ncode\n```\n");
    expect(off).toBe("One line\n\nTwo lines\n\n```\ncode\n```\n");
  });

  it("takes bold out of bold-italic in each block", async () => {
    const [off] = await pressOverAll("***ab***\n\n***cd***\n", "b", 1);
    expect(off).toBe("*ab*\n\n*cd*\n");
  });

  it("merges the bold already in each block", async () => {
    const [on] = await pressOverAll("a **b** c\n\nd\n", "b", 1);
    expect(on).toBe("**a b c**\n\n**d**\n");
  });

  it("formats a list's items each", async () => {
    const [on] = await pressOverAll("- one\n- two\n", "i", 1);
    expect(on).toBe("- *one*\n- *two*\n");
  });
});

describe("Ctrl+` by the rules bold follows", () => {
  it("makes text with bold in it one code, the bold given up", async () => {
    const { saved } = await pressOver("a **b** c\n", 0, 7, "`");
    expect(saved).toBe("`a b c`\n");
  });

  it("merges code already in the selection into one", async () => {
    const { saved } = await pressOver("run `npm` now\n", 0, 13, "`");
    expect(saved).toBe("`run npm now`\n");
  });

  it("takes in all of a code the selection reaches into", async () => {
    // "x `abc` y": x(0) space(1) code(2-7) space(7) y(8).
    const { saved } = await pressOver("x `abc` y\n", 0, 4, "`");
    expect(saved).toBe("`x abc` y\n");
  });

  it("leaves bold outside the selection bold", async () => {
    // "**abcd** e": bold(0-6) with ab at 1-3, cd at 3-5.
    const { saved } = await pressOver("**abcd** e\n", 3, 8, "`");
    expect(saved).toBe("**ab**`cd e`\n");
  });

  it("makes each block's text code after Select All, and takes it off again", async () => {
    const [on, off] = await pressOverAll("a **b**\n\nc\n", "`", 2);
    expect(on).toBe("`a b`\n\n`c`\n");
    expect(off).toBe("a b\n\nc\n");
  });
});
