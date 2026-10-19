import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { computeCharDeleteBesideEnclosure } from "./enclosure";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    md_span: { content: "inline*", group: "inline", inline: true },
    text: { group: "inline" },
  },
});

/** "<before>**3**<after>" with the caret `caret` positions into the paragraph. */
function stateWith(before: string, after: string, caret: number) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      ...(before ? [schema.text(before)] : []),
      schema.node("md_span", null, [schema.text("3")]),
      ...(after ? [schema.text(after)] : []),
    ]),
  ]);
  const state = EditorState.create({ doc });
  return state.apply(
    state.tr.setSelection(TextSelection.create(doc, 1 + caret)),
  );
}

// Paragraph offsets: 前 0-1, md_span 1-4 (its "3" at 2-3), then the text after.
describe("computeCharDeleteBesideEnclosure", () => {
  it("deletes the one character after a span, so the caret stays outside it (#199)", () => {
    expect(
      computeCharDeleteBesideEnclosure(stateWith("前", "位。", 5), "backward"),
    ).toEqual({ from: 5, to: 6 });
  });

  it("deletes the one character before a span going forward", () => {
    expect(
      computeCharDeleteBesideEnclosure(stateWith("前", "", 0), "forward"),
    ).toEqual({ from: 1, to: 2 });
  });

  it("deletes a whole surrogate pair", () => {
    expect(
      computeCharDeleteBesideEnclosure(stateWith("", "😀x", 5), "backward"),
    ).toEqual({ from: 4, to: 6 });
  });

  it("leaves deletions that don't end beside a span to the browser", () => {
    expect(
      computeCharDeleteBesideEnclosure(stateWith("前", "位。", 6), "backward"),
    ).toBeNull();
    expect(
      computeCharDeleteBesideEnclosure(stateWith("前", "位。", 4), "backward"),
    ).toBeNull();
    expect(
      computeCharDeleteBesideEnclosure(stateWith("前", "位。", 5), "forward"),
    ).toBeNull();
  });
});
