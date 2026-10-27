import { describe, expect, it } from "vitest";
import { Schema, type Mark } from "@milkdown/kit/prose/model";
import {
  checkedText,
  issuesToDecorations,
  touchesCode,
} from "./grammar-check-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
  marks: {
    inlineCode: { code: true, toDOM: () => ["code", 0] },
    strong: { toDOM: () => ["strong", 0] },
  },
});

/** "Run `npm instal` and read the **offical** guide." */
function paragraph() {
  const text = (t: string, marks?: readonly Mark[]) => schema.text(t, marks);
  const code = schema.marks.inlineCode.create();
  const strong = schema.marks.strong.create();
  return schema.nodes.paragraph.create(null, [
    text("Run "),
    text("npm instal", [code]),
    text(" and read the "),
    text("offical", [strong]),
    text(" guide."),
  ]);
}

describe("checkedText", () => {
  it("masks inline code one unit apiece and keeps the rest", () => {
    const para = paragraph();
    const checked = checkedText(para);
    expect(checked).toBe("Run •••••••••• and read the offical guide.");
    expect(checked.length).toBe(para.textContent.length);
  });
});

describe("touchesCode", () => {
  it("is true only for ranges that reach into inline code", () => {
    const para = paragraph();
    expect(touchesCode(para, 8, 14)).toBe(true); // "instal"
    expect(touchesCode(para, 2, 5)).toBe(true); // "n `npm" edge
    expect(touchesCode(para, 28, 35)).toBe(false); // "offical"
    expect(touchesCode(para, 0, 3)).toBe(false); // "Run"
  });
});

describe("issuesToDecorations", () => {
  it("drops fixes inside inline code and fixes that change nothing", () => {
    const para = paragraph();
    const text = para.textContent;
    const at = (s: string) => text.indexOf(s);
    const decorations = issuesToDecorations(
      para,
      [
        {
          start: at("instal"),
          end: at("instal") + 6,
          issue: "typo",
          suggestion: "install",
          original: "instal",
        },
        {
          start: at("offical"),
          end: at("offical") + 7,
          issue: "typo",
          suggestion: "official",
          original: "offical",
        },
        {
          start: at("guide"),
          end: at("guide") + 5,
          issue: "no-op",
          suggestion: "guide",
          original: "guide",
        },
      ],
      1,
    );
    expect(decorations.map((d) => d.spec.suggestion)).toEqual(["official"]);
  });
});
