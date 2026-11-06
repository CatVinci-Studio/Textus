import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { headingPos, htmlAnchorPos, referencePos } from "./heading-jump";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { content: "text*", group: "block" },
    text: { group: "inline" },
    html: { content: "text*", group: "inline", inline: true },
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

describe("headingPos for wikilinks' blocks and levels", () => {
  const leveled = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "text*", group: "block" },
      heading: {
        content: "text*",
        group: "block",
        attrs: { level: { default: 1 } },
      },
      list: { content: "paragraph+", group: "block" },
      text: {},
    },
  });
  const p = (text: string) =>
    leveled.node("paragraph", null, text ? [leveled.text(text)] : []);
  const h = (level: number, text: string) =>
    leveled.node("heading", { level }, [leveled.text(text)]);
  const book = leveled.node("doc", null, [
    h(1, "A"), // 0
    h(2, "B"), // 3
    h(1, "C"), // 6
    h(2, "B"), // 9
    p("A line ^abc123"), // 12
    leveled.node("list", null, [p("one"), p("two")]),
    p("^list1"),
    h(2, "abc123"),
  ]);

  it("finds B under C, not the first B", () => {
    expect(headingPos(book, "C#B")).toBe(10);
    expect(headingPos(book, "A#B")).toBe(4);
    expect(headingPos(book, "A#C")).toBeNull();
  });

  it("finds a block by its ^id, never a heading of that name", () => {
    expect(headingPos(book, "^abc123")).toBe(13);
    expect(headingPos(book, "^list1")).toBe(29);
    expect(headingPos(book, "^nope")).toBeNull();
  });
});

describe("htmlAnchorPos", () => {
  const html = (source: string) =>
    schema.node("html", null, [schema.text(source)]);
  const page = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("Intro")]),
    schema.node("paragraph", null, [
      schema.text("See "),
      html('<a id="note1"></a>'),
    ]),
    schema.node("paragraph", null, [html("<a name=old.2>")]),
  ]);

  it("finds an element by its id or name", () => {
    expect(htmlAnchorPos(page, "note1")).toBe(13);
    expect(htmlAnchorPos(page, "old.2")).not.toBeNull();
  });

  it("matches the whole id only", () => {
    expect(htmlAnchorPos(page, "note")).toBeNull();
    expect(htmlAnchorPos(page, "old")).toBeNull();
  });
});
