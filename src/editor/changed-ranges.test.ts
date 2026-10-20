import { describe, expect, it } from "vitest";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { Decoration, type DecorationSet } from "@milkdown/kit/prose/view";
import { decorateAll, redecorateChanged } from "./changed-ranges";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    code_block: { content: "text*", group: "block", code: true },
    text: {},
  },
});

const isCode = (node: ProseNode) => node.type.name === "code_block";
const mark = (node: ProseNode, pos: number) => [
  Decoration.node(pos, pos + node.nodeSize, { class: "x" }),
];

const ranges = (set: DecorationSet) => set.find().map((d) => [d.from, d.to]);

function start() {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("one")]),
    schema.node("code_block", null, [schema.text("a\nb")]),
    schema.node("paragraph", null, [schema.text("two")]),
  ]);
  const state = EditorState.create({ doc });
  return { state, set: decorateAll(doc, isCode, mark) };
}

describe("redecorateChanged", () => {
  it("draws the same as drawing everything, after each kind of edit", () => {
    let { state, set } = start();
    const step = (tr: ReturnType<typeof state.tr.insertText>) => {
      set = redecorateChanged(set, tr, isCode, mark);
      state = state.apply(tr);
      expect(ranges(set)).toEqual(ranges(decorateAll(state.doc, isCode, mark)));
    };
    // Typing above a block moves it; typing inside it keeps it.
    step(state.tr.insertText("zz", 1));
    step(state.tr.insertText("\nc", 10));
    // A new block, and a block replaced by a paragraph.
    step(
      state.tr.insert(
        state.doc.content.size,
        schema.node("code_block", null, [schema.text("new")]),
      ),
    );
    const firstBlock = state.doc.child(0).nodeSize;
    step(
      state.tr.setBlockType(
        firstBlock + 1,
        firstBlock + 1,
        schema.nodes.paragraph,
      ),
    );
    expect(ranges(set)).toHaveLength(1);
  });

  it("draws nothing again for an edit away from every block", () => {
    const { state, set } = start();
    let drawn = 0;
    const next = redecorateChanged(
      set,
      state.tr.insertText("!", state.doc.content.size - 1),
      isCode,
      (node, pos) => {
        drawn++;
        return mark(node, pos);
      },
    );
    expect(drawn).toBe(0);
    expect(ranges(next)).toEqual(ranges(set));
  });
});

describe("redecorateChanged, blocks side by side", () => {
  const two = () => {
    const doc = schema.node("doc", null, [
      schema.node("code_block", null, [schema.text("a")]),
      schema.node("code_block", null, [schema.text("b")]),
    ]);
    return {
      state: EditorState.create({ doc }),
      set: decorateAll(doc, isCode, mark),
    };
  };

  it("keeps the next block's decoration when one block is edited", () => {
    const { state, set } = two();
    const tr = state.tr.insertText("!", 2);
    expect(ranges(redecorateChanged(set, tr, isCode, mark))).toEqual([
      [0, 4],
      [4, 7],
    ]);
  });

  it("drops what a block drew inside it once it no longer matches", () => {
    const { state } = two();
    const tokens = (node: ProseNode, pos: number) => [
      Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: "t" }),
    ];
    const set = decorateAll(state.doc, isCode, tokens);
    const tr = state.tr.setBlockType(1, 1, schema.nodes.paragraph);
    expect(ranges(redecorateChanged(set, tr, isCode, tokens))).toEqual([
      [4, 5],
    ]);
  });
});
