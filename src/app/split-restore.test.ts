import { describe, expect, it } from "vitest";
import { readSavedSplit } from "./split-restore";

describe("readSavedSplit", () => {
  it("reads a split by its two paths, the share kept in bounds", () => {
    expect(
      readSavedSplit({
        direction: "column",
        ratio: 0.95,
        paths: ["/a.md", "/b.md"],
      }),
    ).toEqual({ direction: "column", ratio: 0.8, paths: ["/a.md", "/b.md"] });
  });

  it("takes nothing that isn't one", () => {
    expect(readSavedSplit(null)).toBeNull();
    expect(
      readSavedSplit({ direction: "diagonal", paths: ["/a", "/b"] }),
    ).toBeNull();
    expect(readSavedSplit({ direction: "row", paths: ["/a"] })).toBeNull();
    expect(
      readSavedSplit({ direction: "row", paths: ["/a", "/a"] }),
    ).toBeNull();
    expect(readSavedSplit({ direction: "row", paths: ["/a", ""] })).toBeNull();
  });

  it("halves a share it can't read", () => {
    expect(
      readSavedSplit({ direction: "row", paths: ["/a", "/b"] })?.ratio,
    ).toBe(0.5);
  });
});
