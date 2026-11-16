// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { Schema, type Node } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { joinListsAfter } from "./join-lists-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    bullet_list: { group: "block", content: "list_item+" },
    ordered_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*" },
    text: {},
  },
});
const n = schema.nodes;
const p = (text = "") =>
  n.paragraph.create(null, text ? schema.text(text) : []);
const item = (text: string) => n.list_item.create(null, p(text));
const list = (...texts: string[]) =>
  n.bullet_list.create(null, texts.map(item));
const doc = (...blocks: Node[]) => n.doc.create(null, blocks);

/** The doc after deleting `block` (by index) and the join. */
function deleteBlock(start: Node, index: number): Node {
  const state = EditorState.create({ doc: start });
  let pos = 0;
  for (let i = 0; i < index; i++) pos += start.child(i).nodeSize;
  const tr = state.tr.delete(pos, pos + start.child(index).nodeSize);
  return (joinListsAfter(start, tr, tr.mapping.invert()) ?? tr).doc;
}

afterEach(closeViews);

describe("lists an edit brings together", () => {
  it("deleting a middle task with Backspace leaves one list", async () => {
    const t = await openView("- [ ] one\n- [ ] two\n- [ ] three\n", {
      enableCompletion: false,
    });
    t.caretAt("two", 3);
    // Its text, the task taken back to a line, then the line.
    for (let i = 0; i < 5; i++) t.press("Backspace");
    expect(t.markdown()).toMatch(/^([-*]) \[ \] one\n\1 \[ \] three$/);
  });

  it("are one list again once what stood between them goes", () => {
    // A task taken back to a line of text, then that line deleted.
    const out = deleteBlock(doc(list("one"), p(), list("three")), 1);
    expect(out.eq(doc(list("one", "three")))).toBe(true);
  });

  it("keep apart where the file had them touching already", () => {
    // Two lists the file wrote with two markers, and an edit elsewhere.
    const start = doc(list("a"), list("b"), p("x"), p("y"));
    const out = deleteBlock(start, 3);
    expect(out.eq(doc(list("a"), list("b"), p("x")))).toBe(true);
  });

  it("never join lists of two kinds", () => {
    const numbered = n.ordered_list.create(null, [item("two")]);
    const out = deleteBlock(doc(list("one"), p(), numbered), 1);
    expect(out.childCount).toBe(2);
  });
});
