import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { touchesHeading } from "./heading-id-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    heading: { content: "text*", group: "block" },
    paragraph: { content: "text*", group: "block" },
    text: {},
  },
});

// "# Title" then a paragraph: heading 0..7, paragraph 7..13.
const state = EditorState.create({
  doc: schema.node("doc", null, [
    schema.node("heading", null, [schema.text("Title")]),
    schema.node("paragraph", null, [schema.text("body")]),
  ]),
});

describe("touchesHeading", () => {
  it("is false for typing in a paragraph", () => {
    expect(touchesHeading(state.tr.insertText("x", 9))).toBe(false);
  });

  it("is true for typing in a heading", () => {
    expect(touchesHeading(state.tr.insertText("x", 3))).toBe(true);
  });

  it("is true for a heading deleted or added", () => {
    expect(touchesHeading(state.tr.delete(0, 7))).toBe(true);
    const heading = schema.node("heading", null, [schema.text("New")]);
    expect(touchesHeading(state.tr.insert(13, heading))).toBe(true);
  });

  it("is true for a paragraph turned into a heading", () => {
    const tr = state.tr.setBlockType(8, 8, schema.nodes.heading);
    expect(touchesHeading(tr)).toBe(true);
  });
});
