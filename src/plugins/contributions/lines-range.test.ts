import { describe, expect, it } from "vitest";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { linesRange } from "./editor-text";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    blockquote: { content: "block+", group: "block" },
    bullet_list: { content: "list_item+", group: "block" },
    list_item: { content: "paragraph block*" },
    text: {},
  },
});
const p = (text = "") =>
  schema.node("paragraph", null, text ? schema.text(text) : []);
const item = (text: string) => schema.node("list_item", null, [p(text)]);

/** `doc` with the caret at the start of its text block holding `text`. */
function at(doc: ProseNode, text: string) {
  let pos = -1;
  doc.descendants((node, at) => {
    if (pos < 0 && node.isTextblock && node.textContent === text) pos = at + 1;
  });
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, pos),
  });
}

/** What deleting the lines leaves. */
function deleted(state: EditorState, count: number) {
  const { from, to } = linesRange(state, count);
  return state.tr.delete(from, to).doc.toJSON();
}

describe("Vim's lines, as dd and V take them", () => {
  it("take an empty quote's only line with the quote", () => {
    const doc = schema.node("doc", null, [
      p("before"),
      schema.node("blockquote", null, [p()]),
      p("after"),
    ]);
    expect(deleted(at(doc, ""), 1)).toEqual(
      schema.node("doc", null, [p("before"), p("after")]).toJSON(),
    );
  });

  it("go on into the next list items", () => {
    const doc = schema.node("doc", null, [
      schema.node("bullet_list", null, [
        item("one"),
        item("two"),
        item("three"),
      ]),
    ]);
    const lines = linesRange(at(doc, "one"), 2);
    expect(lines.text).toBe("one\ntwo\n");
    expect(deleted(at(doc, "one"), 2)).toEqual(
      schema
        .node("doc", null, [schema.node("bullet_list", null, [item("three")])])
        .toJSON(),
    );
  });
});
