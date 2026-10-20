import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
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
