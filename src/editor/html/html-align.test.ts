// @vitest-environment jsdom
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

describe("align tags in the editor", () => {
  it("hide again once the caret leaves, even with no block to align", async () => {
    const { createTestEditor } = await import("../editor-test-kit");
    const { editorViewCtx } = await import("@milkdown/kit/core");
    const { TextSelection } = await import("@milkdown/kit/prose/state");
    const editor = await createTestEditor('Text\n\n<p align="center">\n');
    const view = editor.ctx.get(editorViewCtx);
    const hiddenTags = () =>
      view.dom.querySelectorAll(".html-align-tag").length;
    const tagAt = view.state.doc.content.size - 2;
    const go = (pos: number) =>
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
      );
    const before = hiddenTags();
    // Typed with the caret on the tag, then the caret leaves.
    go(tagAt);
    view.dispatch(view.state.tr.insertText("!", 2));
    go(1);
    expect(hiddenTags()).toBe(before);
    expect(before).toBeGreaterThan(0);
    await editor.destroy();
  });
});
