import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, type Transaction } from "@milkdown/kit/prose/state";
import {
  createLazyBlocksPlugin,
  flipOf,
  isBlockDrawn,
  lazyBlocksKey,
  topLevelIndex,
  type LazyBlocksMeta,
} from "./lazy-blocks-state";

const schema = new Schema({
  nodes: {
    doc: { content: "(paragraph | math_block)+" },
    paragraph: { content: "text*" },
    math_block: { content: "text*" },
    text: {},
  },
});

/** `count` paragraphs of 100 characters; 2,000 is past the threshold. */
function start(count: number) {
  const line = (i: number) => `${i}`.padEnd(100, ".");
  return EditorState.create({
    schema,
    doc: schema.node(
      "doc",
      null,
      Array.from({ length: count }, (_, i) =>
        schema.node("paragraph", null, schema.text(line(i))),
      ),
    ),
    plugins: [createLazyBlocksPlugin()],
  });
}

/** Indices of the paragraphs drawn in full. */
function drawn(state: EditorState): number[] {
  const plugin = lazyBlocksKey.getState(state)!;
  const found: number[] = [];
  state.doc.forEach((node, pos, index) => {
    if (isBlockDrawn(plugin, pos, node)) found.push(index);
  });
  return found;
}

/** Indices of the blocks the view is told to draw anew: drawn or not. */
function flips(state: EditorState): Record<number, boolean> {
  const set = lazyBlocksKey.getState(state)!.flips;
  const found: Record<number, boolean> = {};
  state.doc.forEach((node, pos, index) => {
    const flip = flipOf(
      set
        .find(pos, pos + node.nodeSize)
        .filter((d) => d.from === pos && d.to === pos + node.nodeSize),
    );
    if (flip !== undefined) found[index] = flip;
  });
  return found;
}

/** The position of paragraph `index`'s start. */
function blockStart(state: EditorState, index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += state.doc.child(i).nodeSize;
  return at;
}

const withMeta = (tr: Transaction, meta: LazyBlocksMeta) =>
  tr.setMeta(lazyBlocksKey, meta);

describe("drawing a long document's blocks lazily", () => {
  it("keeps the caret's block drawn when the view releases it", () => {
    let state = start(2000);
    state = state.apply(
      withMeta(state.tr, { release: [0, blockStart(state, 5)] }),
    );
    expect(drawn(state)).toContain(0);
    expect(drawn(state)).not.toContain(5);
  });

  it("draws both halves of a paragraph split in two", () => {
    let state = start(2000);
    state = state.apply(state.tr.split(blockStart(state, 10) + 50));
    expect(drawn(state)).toEqual(expect.arrayContaining([10, 11]));
  });

  it("draws what is pasted far from the drawn blocks", () => {
    let state = start(2000);
    const at = blockStart(state, 1800);
    state = state.apply(
      state.tr.insert(at, schema.node("paragraph", null, schema.text("new"))),
    );
    expect(drawn(state)).toContain(1800);
    expect(state.doc.child(1800).textContent).toBe("new");
  });

  it("draws only the ends of a change as large as a reload", () => {
    let state = start(2000);
    const fresh = start(2000).doc;
    state = state.apply(
      state.tr.replaceWith(0, state.doc.content.size, fresh.content),
    );
    expect(drawn(state).length).toBeLessThan(50);
    expect(drawn(state)).toContain(1999);
  });

  it("stays on until the document is a tenth below the threshold", () => {
    let state = start(2000);
    // 1,600 paragraphs: below the threshold, above nine tenths of it.
    state = state.apply(
      state.tr.delete(blockStart(state, 1600), state.doc.content.size),
    );
    expect(lazyBlocksKey.getState(state)!.active).toBe(true);
    state = state.apply(
      state.tr.delete(blockStart(state, 1000), state.doc.content.size),
    );
    expect(lazyBlocksKey.getState(state)!.active).toBe(false);
    expect(drawn(state)).toEqual([]);
  });
});

describe("what turns it on", () => {
  /** `count` blocks of a short formula's length, each a `type`. */
  const blocks = (count: number, type: string) =>
    EditorState.create({
      schema,
      doc: schema.node(
        "doc",
        null,
        Array.from({ length: count }, (_, i) =>
          schema.node(type, null, schema.text(`x_{${i}}^2`)),
        ),
      ),
      plugins: [createLazyBlocksPlugin()],
    });

  it("is how heavy the document is to draw, not its length", () => {
    // A few thousand characters either way: as formulas, too much to draw.
    expect(lazyBlocksKey.getState(blocks(120, "math_block"))!.active).toBe(
      true,
    );
    expect(lazyBlocksKey.getState(blocks(120, "paragraph"))!.active).toBe(
      false,
    );
  });
});

describe("what the view is told", () => {
  it("is nothing while typing in a drawn block", () => {
    let state = start(2000);
    state = state.apply(state.tr.insertText("x", 3));
    expect(flips(state)).toEqual({});
    expect(lazyBlocksKey.getState(state)!.flips.find()).toHaveLength(0);
  });

  it("is the blocks drawn and released, for that transaction only", () => {
    let state = start(2000);
    state = state.apply(
      withMeta(state.tr, {
        draw: [blockStart(state, 900)],
        release: [blockStart(state, 30)],
      }),
    );
    expect(flips(state)).toEqual({ 30: false, 900: true });
    state = state.apply(state.tr.insertText("x", 3));
    expect(flips(state)).toEqual({});
  });
});

describe("finding a top-level block by position", () => {
  it("finds the block a position is in, its start and its end included", () => {
    const { doc } = start(10);
    // Each paragraph is 102 positions long.
    expect(topLevelIndex(doc, 0)).toBe(0);
    expect(topLevelIndex(doc, 101)).toBe(0);
    expect(topLevelIndex(doc, 102)).toBe(1);
    expect(topLevelIndex(doc, doc.content.size)).toBe(9);
  });
});
