import { describe, expect, it } from "vitest";
import { blockHunks } from "./file-changes-plugin";

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
