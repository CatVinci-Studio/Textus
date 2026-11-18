import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { estimateHeight, type TextMetrics } from "./estimate-height";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { content: "inline*", group: "block" },
    code_block: { content: "text*", group: "block", code: true },
    bullet_list: { content: "list_item+", group: "block" },
    list_item: { content: "paragraph+" },
    hr: { group: "block" },
    image: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
});

const metrics: TextMetrics = { lineHeight: 30, charsPerLine: 40, blockGap: 10 };
const p = (text: string) => schema.node("paragraph", null, schema.text(text));

describe("a placeholder's estimated height", () => {
  it("is a line for a short paragraph", () => {
    expect(estimateHeight(p("短"), metrics)).toBe(40);
  });

  it("wraps CJK text at the column's width", () => {
    expect(estimateHeight(p("中".repeat(100)), metrics)).toBe(3 * 30 + 10);
  });

  it("counts Latin letters as about half a CJK character", () => {
    expect(estimateHeight(p("a".repeat(100)), metrics)).toBe(2 * 30 + 10);
  });

  it("counts a code block's lines, not its width", () => {
    const code = schema.node("code_block", null, schema.text("a\nb\nc"));
    expect(estimateHeight(code, metrics)).toBe(3 * 30 + 10);
  });

  it("adds up a list's paragraphs", () => {
    const list = schema.node("bullet_list", null, [
      schema.node("list_item", null, [p("one")]),
      schema.node("list_item", null, [p("two")]),
    ]);
    expect(estimateHeight(list, metrics)).toBe(2 * 40);
  });

  it("leaves room for a picture", () => {
    const picture = schema.node("paragraph", null, [schema.node("image")]);
    expect(estimateHeight(picture, metrics)).toBeGreaterThan(200);
  });
});
