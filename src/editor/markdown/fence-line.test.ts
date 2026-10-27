import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { fenceLineToBlock } from "./fence-line";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*" },
    code_block: {
      group: "block",
      content: "text*",
      code: true,
      attrs: { language: { default: "" } },
    },
    text: { group: "inline" },
  },
});
const n = schema.nodes;
const fence = () => n.paragraph.create(null, schema.text("```js"));

describe("fenceLineToBlock", () => {
  it("turns the fence line itself into the block", () => {
    const state = EditorState.create({
      schema,
      doc: n.doc.create(null, fence()),
    });
    const tr = fenceLineToBlock(state, 0, n.code_block, { language: "js" });
    expect(
      tr.doc.eq(n.doc.create(null, n.code_block.create({ language: "js" }))),
    ).toBe(true);
    expect(tr.selection.$from.parent.type).toBe(n.code_block);
  });

  it("puts the block below a list item's first line, which stays a paragraph", () => {
    const list = n.bullet_list.create(null, n.list_item.create(null, fence()));
    const state = EditorState.create({ schema, doc: n.doc.create(null, list) });
    const tr = fenceLineToBlock(state, 2, n.code_block, { language: "js" });
    const item = tr.doc.firstChild!.firstChild!;
    expect(item.childCount).toBe(2);
    expect(item.firstChild!.content.size).toBe(0);
    expect(item.lastChild!.type).toBe(n.code_block);
    expect(tr.selection.$from.parent.type).toBe(n.code_block);
  });
});
