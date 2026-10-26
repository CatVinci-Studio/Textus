import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { locatePlainText } from "./text-locate";

// Just enough schema for marked and unmarked text, so the tests cover
// position mapping across mark boundaries.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    text: { group: "inline" },
  },
  marks: {
    strong: { toDOM: () => ["strong", 0], parseDOM: [{ tag: "strong" }] },
  },
});

function paragraph(...content: Parameters<typeof schema.node>[2][]) {
  return schema.node("paragraph", null, content as never);
}

function doc(...paragraphs: ReturnType<typeof paragraph>[]) {
  return schema.node("doc", null, paragraphs);
}

describe("locatePlainText", () => {
  it("locates a unique plain-text needle within a block", () => {
    const d = doc(paragraph(schema.text("This is important content")));
    const match = locatePlainText(d, 0, d.content.size, "important");
    expect(match).not.toBeNull();
    expect(d.textBetween(match!.from, match!.to)).toBe("important");
  });

  it("maps positions correctly across a mark boundary", () => {
    // The search runs on rendered plain text, so the mark doesn't shift it.
    const d = doc(
      paragraph(
        schema.text("This is "),
        schema.text("important", [schema.mark("strong")]),
        schema.text(" content"),
      ),
    );
    const match = locatePlainText(d, 0, d.content.size, "important");
    expect(match).not.toBeNull();
    expect(d.textBetween(match!.from, match!.to)).toBe("important");
  });

  it("returns null when the needle is absent", () => {
    const d = doc(paragraph(schema.text("hello world")));
    expect(locatePlainText(d, 0, d.content.size, "goodbye")).toBeNull();
  });

  it("returns null when the needle is ambiguous (occurs more than once)", () => {
    const d = doc(paragraph(schema.text("same same")));
    expect(locatePlainText(d, 0, d.content.size, "same")).toBeNull();
  });

  it("returns null for an empty needle rather than matching everywhere", () => {
    const d = doc(paragraph(schema.text("hello")));
    expect(locatePlainText(d, 0, d.content.size, "")).toBeNull();
  });

  it("locates a needle at the very start and very end of the range", () => {
    const d = doc(paragraph(schema.text("start middle end")));
    const size = d.content.size;
    const start = locatePlainText(d, 0, size, "start");
    expect(start).not.toBeNull();
    expect(d.textBetween(start!.from, start!.to)).toBe("start");
    const end = locatePlainText(d, 0, size, "end");
    expect(end).not.toBeNull();
    expect(d.textBetween(end!.from, end!.to)).toBe("end");
  });

  it("counts a hard break, so a strike after one ends where the text does", () => {
    const withBreak = new Schema({
      nodes: schema.spec.nodes.append({
        hardbreak: {
          group: "inline",
          inline: true,
          leafText: () => "\n",
          toDOM: () => ["br"],
        },
      }),
    });
    const d = withBreak.node("doc", null, [
      withBreak.node("paragraph", null, [
        withBreak.text("First line."),
        withBreak.node("hardbreak"),
        withBreak.text("Second line."),
        withBreak.node("hardbreak"),
        withBreak.text("Third."),
      ]),
    ]);
    const match = locatePlainText(
      d,
      0,
      d.content.size,
      "First line.\nSecond line.",
    );
    expect(match).not.toBeNull();
    expect(d.textBetween(match!.from, match!.to, "", "|")).toBe(
      "First line.|Second line.",
    );
    const third = locatePlainText(d, 0, d.content.size, "Third.");
    expect(d.textBetween(third!.from, third!.to)).toBe("Third.");
  });
});
