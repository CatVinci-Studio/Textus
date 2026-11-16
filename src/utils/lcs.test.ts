import { describe, expect, it } from "vitest";
import { sharedEnds } from "./lcs";

describe("sharedEnds", () => {
  it("counts the shared start, then the shared end after it", () => {
    expect(sharedEnds("the cat sat", "the dog sat")).toEqual({
      start: 4,
      end: 4,
    });
  });

  it("never lets the end overlap the start", () => {
    expect(sharedEnds("aa", "aaa")).toEqual({ start: 2, end: 0 });
  });

  it("compares by the given rule", () => {
    const a = [{ c: "x" }, { c: "y" }];
    const b = [{ c: "x" }, { c: "z" }];
    expect(sharedEnds(a, b, (p, q) => p.c === q.c)).toEqual({
      start: 1,
      end: 0,
    });
  });
});
