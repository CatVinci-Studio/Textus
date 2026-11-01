import { describe, expect, it } from "vitest";
import { Fragment, Schema, type Node } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { fastFindIndex, fastForChild } from "./prosemirror-speedups";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    image: { group: "inline", inline: true, atom: true },
  },
});

/** A document of `n` paragraphs of varying length, some with an image. */
function doc(n: number, seed = 7): Node {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const blocks = Array.from({ length: n }, (_, i) =>
    schema.node("paragraph", null, [
      ...(i % 5 === 0 ? [schema.node("image")] : []),
      ...(rand() < 0.1
        ? []
        : [schema.text("x".repeat(1 + Math.floor(rand() * 40)))]),
    ]),
  );
  return schema.node("doc", null, blocks);
}

const originalFindIndex = (
  Fragment.prototype as unknown as {
    findIndex: (pos: number) => { index: number; offset: number };
  }
).findIndex;
const originalForChild = (
  DecorationSet.prototype as unknown as {
    forChild: (offset: number, node: Node) => DecorationSet;
  }
).forChild;

describe("fastFindIndex", () => {
  it("answers as Fragment.findIndex at every position", () => {
    const fragment = doc(300).content;
    for (let pos = 0; pos <= fragment.size; pos++) {
      const { index, offset } = originalFindIndex.call(fragment, pos);
      expect(fastFindIndex(fragment, pos, originalFindIndex)).toEqual({
        index,
        offset,
      });
    }
  });

  it("still refuses a position outside the fragment", () => {
    const fragment = doc(100).content;
    expect(() =>
      fastFindIndex(fragment, fragment.size + 1, originalFindIndex),
    ).toThrow(RangeError);
  });
});

describe("fastForChild", () => {
  const d = doc(300);
  const nodeDecos: Decoration[] = [];
  const childDecos: Decoration[] = [];
  d.forEach((child, pos, i) => {
    if (i % 3 === 0)
      nodeDecos.push(
        Decoration.node(pos, pos + child.nodeSize, { class: "n" }),
      );
    if (i % 4 === 0)
      nodeDecos.push(
        Decoration.widget(pos, () => document.createElement("span")),
      );
    child.forEach((inner, offset) => {
      if (inner.type.name === "image")
        childDecos.push(
          Decoration.node(pos + 1 + offset, pos + 2 + offset, { class: "i" }),
        );
    });
  });
  const shape = (set: DecorationSet) =>
    set.find().map((deco) => [deco.from, deco.to, deco.spec]);

  for (const [name, decos] of [
    [
      "node and widget decorations, and decorations inside blocks",
      [...nodeDecos, ...childDecos],
    ],
    [
      "with an inline decoration across blocks too",
      [...nodeDecos, Decoration.inline(3, 400, { class: "x" })],
    ],
  ] as const) {
    it(`gives each block the same set as forChild: ${name}`, () => {
      const set = DecorationSet.create(d, [...decos]);
      d.forEach((child, offset) => {
        expect(
          shape(fastForChild(set, offset, child, originalForChild)),
        ).toEqual(shape(originalForChild.call(set, offset, child)));
      });
    });
  }
});
