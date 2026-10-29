import { describe, expect, it } from "vitest";
import { readSavedSplit } from "./split-restore";

describe("readSavedSplit", () => {
  it("reads a saved tree of panes by their documents' paths", () => {
    const tree = {
      direction: "row",
      sizes: [1, 1],
      children: [
        { path: "/a.md" },
        {
          direction: "column",
          sizes: [0.3, 0.7],
          children: [{ path: "/b.md" }, { path: "/c.md" }],
        },
      ],
    };
    expect(readSavedSplit({ tree })).toEqual({
      ...tree,
      sizes: [0.5, 0.5],
    });
  });

  it("reads the pair earlier versions saved", () => {
    expect(
      readSavedSplit({
        direction: "column",
        ratio: 0.25,
        paths: ["/a.md", "/b.md"],
      }),
    ).toEqual({
      direction: "column",
      sizes: [0.25, 0.75],
      children: [{ path: "/a.md" }, { path: "/b.md" }],
    });
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
    expect(readSavedSplit({ tree: { path: "/a" } })).toBeNull();
  });
});
