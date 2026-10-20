// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { indentCodeLines } from "./tab-extend-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    code_block: { group: "block", content: "text*", code: true },
    text: {},
  },
});

/** A code block holding `text`, selected from `from` to `to` (offsets in
 *  the text). */
function codeState(text: string, from: number, to = from): EditorState {
  const doc = schema.node("doc", null, [
    schema.node("code_block", null, text ? schema.text(text) : undefined),
  ]);
  const state = EditorState.create({ schema, doc });
  return state.apply(
    state.tr.setSelection(TextSelection.create(doc, from + 1, to + 1)),
  );
}

const textAfter = (state: EditorState, direction: 1 | -1) =>
  state.apply(indentCodeLines(state, direction)!).doc.textContent;

describe("indentCodeLines", () => {
  it("puts an indent in at the caret", () => {
    expect(textAfter(codeState("ab", 1), 1)).toBe("a  b");
  });

  it("indents every selected line instead of replacing them", () => {
    expect(textAfter(codeState("ab\ncd\nef", 1, 4), 1)).toBe("  ab\n  cd\nef");
  });

  it("leaves a line the selection ends at the start of", () => {
    expect(textAfter(codeState("ab\ncd", 0, 3), 1)).toBe("  ab\ncd");
  });

  it("takes one indent off each line touched: two spaces, one, or a tab", () => {
    expect(textAfter(codeState("    ab\n\tcd\n e", 0, 12), -1)).toBe(
      "  ab\ncd\ne",
    );
  });

  it("outdents the caret's line", () => {
    expect(textAfter(codeState("x\n  ab", 5), -1)).toBe("x\nab");
  });

  it("has nothing to do on a line with no indent", () => {
    expect(indentCodeLines(codeState("ab", 1), -1)).toBeNull();
  });
});

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function openView(
  markdown: string,
): Promise<{ view: EditorView; save: () => string }> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    return { view, save: () => ctx.get(serializerCtx)(view.state.doc) };
  });
}

function press(view: EditorView, key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent("keydown", { key, shiftKey });
  return !!view.someProp("handleKeyDown", (f) => f(view, event));
}

function type(view: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

/** The caret at the end of the cell reading `text`. */
function caretInCell(view: EditorView, text: string): void {
  let end = -1;
  view.state.doc.descendants((node, pos) => {
    if (end < 0 && node.type.name === "paragraph" && node.textContent === text)
      end = pos + node.nodeSize - 1;
  });
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
  );
}

/** The caret's cell text with "|" at the caret, or null for a selection. */
function caretIn(view: EditorView): string | null {
  const { $from, empty } = view.state.selection;
  if (!empty) return null;
  const text = $from.parent.textContent;
  return (
    text.slice(0, $from.parentOffset) + "|" + text.slice($from.parentOffset)
  );
}

const TABLE = "| a | b |\n| --- | --- |\n| one | two |\n| three | four |\n";

describe("Tab in a table", () => {
  it("moves to the next cell with the caret at the end of its text", async () => {
    const { view } = await openView(TABLE);
    caretInCell(view, "a");
    expect(press(view, "Tab")).toBe(true);
    expect(caretIn(view)).toBe("b|");
    press(view, "Tab");
    expect(caretIn(view)).toBe("one|");
  });

  it("types after the cell's text instead of over it", async () => {
    const { view, save } = await openView(TABLE);
    caretInCell(view, "one");
    press(view, "Tab");
    type(view, "!");
    expect(save()).toMatch(/\| one +\| two! +\|/);
  });

  it("goes back a cell with Shift+Tab, caret at the end", async () => {
    const { view } = await openView(TABLE);
    caretInCell(view, "one");
    expect(press(view, "Tab", true)).toBe(true);
    expect(caretIn(view)).toBe("b|");
  });

  it("does nothing with Shift+Tab in the first cell", async () => {
    const { view } = await openView(TABLE);
    caretInCell(view, "a");
    expect(press(view, "Tab", true)).toBe(false);
    expect(caretIn(view)).toBe("a|");
  });

  it("adds a row from the last cell, caret in its first cell", async () => {
    const { view } = await openView(TABLE);
    caretInCell(view, "four");
    press(view, "Tab");
    const table = view.state.doc.firstChild!;
    expect(table.childCount).toBe(4);
    expect(caretIn(view)).toBe("|");
    expect(view.state.selection.$from.node(-2)).toBe(table.lastChild);
  });
});
