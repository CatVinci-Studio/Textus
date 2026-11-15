import { describe, expect, it } from "vitest";
import { inOrder } from "./in-order";

describe("inOrder", () => {
  const id = (s: string) => s;

  it("puts the named items in the keys' order, in the places they took", () => {
    expect(inOrder(["a", "x", "b", "y", "c"], id, ["c", "a", "b"])).toEqual([
      "c",
      "x",
      "a",
      "y",
      "b",
    ]);
  });

  it("gives the same array back when nothing moves", () => {
    const items = ["a", "x", "b"];
    expect(inOrder(items, id, ["a", "b"])).toBe(items);
  });
});
