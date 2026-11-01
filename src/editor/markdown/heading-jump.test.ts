import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { headingPos, referencePos } from "./heading-jump";

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

describe("referencePos", () => {
  const paper = doc(
    ["paragraph", "Cooler [2], as found [12]."],
    ["heading", "References"],
    ["paragraph", "[1] One. <https://a.example>"],
    ["paragraph", "[12] Twelve. <https://b.example>"],
    ["paragraph", "[2] Two. <https://c.example>"],
  );

  it("finds the reference list's entry a citation's anchor names", () => {
    const entry = (i: number) => {
      let pos = 0;
      for (let k = 0; k < i; k++) pos += paper.child(k).nodeSize;
      return pos + 1;
    };
    expect(referencePos(paper, "ref-2")).toBe(entry(4));
    expect(referencePos(paper, "ref-12")).toBe(entry(3));
  });

  it("finds nothing for another anchor or a source not listed", () => {
    expect(referencePos(paper, "references")).toBeNull();
    expect(referencePos(paper, "ref-7")).toBeNull();
  });
});
