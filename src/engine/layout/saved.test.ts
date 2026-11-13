import { describe, expect, it } from "vitest";
import { buildSaved, readSavedSplit, savedFront, saveNode } from "./saved";
import { pane, panesOf, type LayoutNode } from "./tree";

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

describe("saveNode and buildSaved", () => {
  it("keeps every island's documents, not just the one in front", () => {
    const layout: LayoutNode = {
      kind: "split",
      direction: "row",
      sizes: [0.4, 0.6],
      children: [
        { kind: "pane", id: "p1", tabs: ["a", "b"], front: "b" },
        { kind: "pane", id: "p2", tabs: ["c", "ai"], front: "c" },
      ],
    };
    const paths: Record<string, string> = {
      a: "/a.md",
      b: "/b.md",
      c: "/c.md",
    };
    const saved = saveNode(layout, (id) => paths[id] ?? null)!;
    expect(saved).toEqual({
      direction: "row",
      sizes: [0.4, 0.6],
      children: [
        { paths: ["/a.md", "/b.md"], front: "/b.md" },
        { paths: ["/c.md"], front: "/c.md" },
      ],
    });
    expect(readSavedSplit({ tree: saved })).toEqual(saved);
    // The island restored in use is the first: its front comes up first.
    expect(savedFront({ tree: saved })).toBe("/b.md");
    // One island keeps its front too, and is no split to restore.
    const one = saveNode(pane(["a", "b"], "b"), (id) => paths[id] ?? null);
    expect(savedFront({ tree: one })).toBe("/b.md");
    expect(readSavedSplit({ tree: one })).toBeNull();
    // Opened again under new ids, one of them gone: the rest come back.
    const idOf = new Map([
      ["/a.md", "x"],
      ["/b.md", "y"],
      ["/c.md", "z"],
    ]);
    const built = buildSaved(saved, idOf);
    expect(built && panesOf(built).map((p) => [p.tabs, p.front])).toEqual([
      [["x", "y"], "y"],
      [["z"], "z"],
    ]);
    idOf.delete("/c.md");
    expect(buildSaved(saved, idOf)).toMatchObject({
      kind: "pane",
      tabs: ["x", "y"],
    });
  });
});
