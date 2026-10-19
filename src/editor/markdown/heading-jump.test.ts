import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { headingPos } from "./heading-jump";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    heading: { content: "text*", group: "block" },
    text: {},
  },
});

const doc = (...blocks: [string, string][]) =>
  schema.node(
    "doc",
    null,
    blocks.map(([type, text]) => schema.node(type, null, [schema.text(text)])),
  );

describe("headingPos", () => {
  const book = doc(
    ["heading", "Intro"],
    ["paragraph", "Text"],
    ["heading", "第一章：開始"],
    ["heading", "Intro"],
  );

  it("finds a heading by its anchor, in any script", () => {
    expect(headingPos(book, "intro")).toBe(1);
    expect(headingPos(book, "第一章開始")).toBe(14);
  });

  it("numbers a repeated heading the way GitHub does", () => {
    expect(headingPos(book, "intro-1")).toBe(
      book.content.size - book.lastChild!.nodeSize + 1,
    );
  });

  it("finds nothing for a heading the document doesn't have", () => {
    expect(headingPos(book, "missing")).toBeNull();
    expect(headingPos(book, "text")).toBeNull();
  });
});
