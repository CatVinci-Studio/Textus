import { describe, expect, it } from "vitest";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  EditorState,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { Decoration, type DecorationSet } from "@milkdown/kit/prose/view";
import {
  applyReveal,
  revealAll,
  type Reveal,
  type RevealState,
} from "./reveal-state";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    quote: { content: "block+", group: "block" },
    math: { content: "text*", group: "inline", inline: true },
    text: { group: "inline" },
  },
});

// A formula renders (a class on its text, a widget after it) while the
// caret is away from it, and shows its source while the caret touches it.
let drawn = 0;
const reveal: Reveal = {
  match: (node) => node.type.name === "math",
  decorate(node, pos, touches) {
    drawn++;
    const to = pos + node.nodeSize;
    if (touches(pos, to)) return [];
    return [
      Decoration.inline(pos + 1, to - 1, { class: "hidden" }),
      Decoration.widget(to, () => document.createElement("span"), {
        key: node.textContent,
      }),
    ];
  },
};

const p = (...content: (ProseNode | string)[]) =>
  schema.node(
    "paragraph",
    null,
    content.map((c) => (typeof c === "string" ? schema.text(c) : c)),
  );
const m = (text: string) => schema.node("math", null, [schema.text(text)]);

// "ab" + $x$ + "cd", then plain paragraphs, then a quote with a formula.
function start(): EditorState {
  const doc = schema.node("doc", null, [
    p("ab", m("x"), "cd"),
    p("one"),
    p("two", m("y")),
    schema.node("quote", null, [p(m("z"), "end")]),
  ]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, doc.child(0).nodeSize + 2),
  });
}

const shape = (set: DecorationSet) =>
  set
    .find()
    .map((d) => `${d.from}-${d.to}:${JSON.stringify(d.spec)}`)
    .sort();

/** Applies `tr`, checking the incremental state against drawing all. */
function step(state: EditorState, prev: RevealState, tr: Transaction) {
  const next = state.apply(tr);
  const reveal2 = applyReveal(tr, prev, state, next, reveal);
  const count = drawn;
  expect(shape(reveal2.set)).toEqual(shape(revealAll(next, reveal).set));
  drawn = count;
  return { state: next, prev: reveal2 };
}

describe("applyReveal", () => {
  it("keeps the state when a caret move flips no recorded range", () => {
    const state = start();
    const prev = revealAll(state, reveal);
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 7));
    drawn = 0;
    expect(applyReveal(tr, prev, state, state.apply(tr), reveal)).toBe(prev);
    expect(drawn).toBe(0);
  });

  it("draws again only the block whose range the caret reached or left", () => {
    let state = start();
    let prev = revealAll(state, reveal);
    drawn = 0;
    // Into $x$, then out of it.
    ({ state, prev } = step(
      state,
      prev,
      state.tr.setSelection(TextSelection.create(state.doc, 4)),
    ));
    expect(drawn).toBe(1);
    step(
      state,
      prev,
      state.tr.setSelection(TextSelection.create(state.doc, 9)),
    );
    expect(drawn).toBe(2);
  });

  it("draws an edit's block again, not the rest of the document", () => {
    const state = start();
    const prev = revealAll(state, reveal);
    drawn = 0;
    const one = state.doc.child(0).nodeSize + 1;
    step(state, prev, state.tr.insertText("!", one + 1));
    expect(drawn).toBe(0);
  });

  it("draws the same as drawing everything, through a run of edits", () => {
    let state = start();
    let prev = revealAll(state, reveal);
    const at = (pos: number) =>
      state.tr.setSelection(TextSelection.create(state.doc, pos));
    const edits: (() => Transaction)[] = [
      () => state.tr.insertText("q", 1),
      () => at(4),
      () => state.tr.insertText("2", 4),
      () => state.tr.delete(2, 3),
      () => state.tr.split(state.selection.from),
      () => state.tr.insert(0, p(m("new"))),
      () => at(state.doc.content.size - 2),
      () => state.tr.delete(0, state.doc.child(0).nodeSize),
      () => state.tr.join(state.doc.child(0).nodeSize),
      () => at(1),
      () => state.tr.insertText("w", state.doc.content.size - 1),
    ];
    for (const edit of edits) ({ state, prev } = step(state, prev, edit()));
  });

  it("draws everything again when its config changes", () => {
    let on = true;
    const switched: Reveal = {
      ...reveal,
      decorate: (node, pos, touches) =>
        on ? reveal.decorate(node, pos, touches) : [],
      config: () => on,
    };
    const state = start();
    const prev = revealAll(state, switched);
    on = false;
    const tr = state.tr;
    const next = applyReveal(tr, prev, state, state.apply(tr), switched);
    expect(next.set.find()).toHaveLength(0);
  });
});
