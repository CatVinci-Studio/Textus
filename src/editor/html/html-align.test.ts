import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { alignedBlocks } from "./html-align";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*" },
    html: { group: "inline", inline: true, content: "text*" },
    text: { group: "inline" },
  },
});
const tag = (source: string) =>
  schema.node("paragraph", null, [
    schema.node("html", null, [schema.text(source)]),
  ]);
const para = (words: string) =>
  schema.node("paragraph", null, [schema.text(words)]);

describe("aligned blocks", () => {
  it("are the blocks between an aligning tag and its close, nested ones innermost", () => {
    const doc = schema.node("doc", null, [
      para("before"),
      tag('<div align="center">'),
      schema.node("heading", null, [schema.text("Title")]),
      tag("<p align=right>"),
      para("signed"),
      tag("</p>"),
      para("centred"),
      tag("</div>"),
      para("after"),
    ]);
    const kinds = alignedBlocks(doc).map(({ from, align }) => [
      doc.resolve(from).nodeAfter!.textContent,
      align,
    ]);
    expect(kinds).toEqual([
      ["Title", "center"],
      ["signed", "right"],
      ["centred", "center"],
    ]);
  });

  it("leave a tag that never closes, or a div without align, alone", () => {
    const doc = schema.node("doc", null, [
      tag("<div>"),
      para("plain"),
      tag("</div>"),
    ]);
    expect(alignedBlocks(doc)).toEqual([]);
  });
});
