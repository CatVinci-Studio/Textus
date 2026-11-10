import { describe, expect, it } from "vitest";
import { blockHunks } from "./block-hunks";
import { placesChanged, revisionProposals } from "./file-revisions";

describe("blockHunks", () => {
  it("finds the blocks changed, added and removed, the rest kept", () => {
    expect(blockHunks(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
    // b changed.
    expect(blockHunks(["a", "b", "c"], ["a", "B", "c"])).toEqual([
      { from: 1, to: 2, baseFrom: 1, baseTo: 2 },
    ]);
    // x added after a; c removed.
    expect(blockHunks(["a", "b", "c"], ["a", "x", "b"])).toEqual([
      { from: 1, to: 2, baseFrom: 1, baseTo: 1 },
      { from: 3, to: 3, baseFrom: 2, baseTo: 3 },
    ]);
    // A file made from nothing is one place.
    expect(blockHunks([], ["a", "b"])).toEqual([
      { from: 0, to: 2, baseFrom: 0, baseTo: 0 },
    ]);
  });
});

describe("a change to a file not open, as revisions", () => {
  const blocks = ["# One", "Two.", "Three."].map((markdown, i) => ({
    id: `b${i}`,
    markdown,
  }));

  it("replaces, deletes and adds each run that differs, by its blocks", () => {
    expect(revisionProposals(blocks, ["# One", "2.", "Three."])).toEqual([
      { action: "replace", block: "b1", text: "2." },
    ]);
    expect(revisionProposals(blocks, ["# One", "Three."])).toEqual([
      { action: "delete", block: "b1" },
    ]);
    expect(
      revisionProposals(blocks, ["# One", "Two.", "Three.", "Four."]),
    ).toEqual([{ action: "insert_after", block: "b2", text: "Four." }]);
    expect(
      revisionProposals(blocks, ["Zero.", ...blocks.map((b) => b.markdown)]),
    ).toEqual([{ action: "insert_before", block: "b0", text: "Zero." }]);
    expect(revisionProposals([], ["New."])).toEqual([
      { action: "append", text: "New." },
    ]);
  });

  it("counts the places a change makes before its file is read", () => {
    expect(placesChanged("A.\n\nB.\n\nC.", "A.\n\nb.\n\nC.\n\nD.")).toBe(2);
    expect(placesChanged("A.", "A.")).toBe(0);
  });
});
