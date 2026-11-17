// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { Schema, type Node } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { joinListsAfter } from "./join-lists-plugin";
import { markChangeSource } from "../change-source";

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

  it("leave lists a plugin's or a paste's text puts side by side", async () => {
    const t = await openView("- one\n\ntext\n\n- three\n", {
      enableCompletion: false,
    });
    const { state } = t.view;
    const para = state.doc.child(1);
    const at = state.doc.child(0).nodeSize;
    const tr = state.tr.delete(at, at + para.nodeSize);
    t.view.dispatch(markChangeSource(tr, "plugin"));
    expect(t.view.state.doc.childCount).toBe(2);
    const paste = t.view.state.tr.insertText("x", 3);
    t.view.dispatch(paste.setMeta("uiEvent", "paste"));
    expect(t.view.state.doc.childCount).toBe(2);
  });

  it("join after an edit marked as the writer's, not the AI's paper", async () => {
    const text = "- one\n\ntext\n\n- three\n";
    const between = (t: Awaited<ReturnType<typeof openView>>) => {
      const { state } = t.view;
      const at = state.doc.child(0).nodeSize;
      return state.tr.delete(at, at + state.doc.child(1).nodeSize);
    };
    const paper = await openView(text, { enableCompletion: false });
    paper.view.dispatch(between(paper).setMeta("addToHistory", false));
    expect(paper.view.state.doc.childCount).toBe(2);
    const own = await openView(text, { enableCompletion: false });
    own.view.dispatch(markChangeSource(between(own), "user"));
    expect(own.view.state.doc.childCount).toBe(1);
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
