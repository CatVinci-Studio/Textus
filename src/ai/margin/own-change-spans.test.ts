import { describe, expect, it } from "vitest";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { Transform } from "@milkdown/kit/prose/transform";
import { ChangeSet } from "@milkdown/kit/prose/changeset";
import { charChanges, shownChanges } from "./own-change-spans";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
  },
});
const doc = (text: string) =>
  schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text(text)]),
  ]);

/** The changes shown after replacing `from`-`to` of `text` with `insert`,
 *  as [before, after] text. */
function shown(text: string, from: number, to: number, insert: string) {
  const base = doc(text);
  const tr = new Transform(base).replaceWith(
    from + 1,
    to + 1,
    schema.text(insert),
  );
  const set = ChangeSet.create(base).addSteps(tr.doc, tr.mapping.maps, null);
  const between = (d: ProseNode, a: number, b: number) => d.textBetween(a, b);
  return shownChanges(set.changes, base, tr.doc).map((c) => [
    between(base, c.fromA, c.toA),
    between(tr.doc, c.fromB, c.toB),
  ]);
}

describe("shownChanges", () => {
  it("shows the characters changed in Chinese, not the whole clause", () => {
    // 时 retyped as 的时间点: only the new characters around it.
    expect(
      shown("雨水从卷帘门底下渗进来时，许知微", 11, 12, "的时间点"),
    ).toEqual([
      ["", "的"],
      ["", "间点"],
    ]);
  });

  it("still grows an English change to whole words", () => {
    expect(shown("the sea was still", 15, 17, "ff")).toEqual([
      ["still", "stiff"],
    ]);
  });
});

describe("charChanges", () => {
  it("finds each run that differs", () => {
    expect(charChanges("卷帘门", "卷闸门")).toEqual([
      { fromA: 1, toA: 2, fromB: 1, toB: 2 },
    ]);
    expect(charChanges("", "新")).toEqual([
      { fromA: 0, toA: 0, fromB: 0, toB: 1 },
    ]);
  });
});
