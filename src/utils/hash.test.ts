import { describe, expect, it } from "vitest";
import { fnv1a } from "./hash";

describe("fnv1a", () => {
  it("gives the published FNV-1a 32-bit values", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
  });

  it("is an unsigned 32-bit number", () => {
    for (const text of ["x", "图", "a longer line of text"]) {
      const h = fnv1a(text);
      expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
    }
  });
});
