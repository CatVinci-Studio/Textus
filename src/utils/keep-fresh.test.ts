import { describe, expect, it } from "vitest";
import { keepFresh } from "./keep-fresh";

describe("keepFresh", () => {
  it("lets the stalest go past its bound, a key kept again being fresh", () => {
    const map = new Map<string, number>();
    keepFresh(map, "a", 1, 2);
    keepFresh(map, "b", 2, 2);
    keepFresh(map, "a", 3, 2);
    keepFresh(map, "c", 4, 2);
    expect([...map]).toEqual([
      ["a", 3],
      ["c", 4],
    ]);
  });
});
