import { describe, expect, it } from "vitest";
import { foldIsland, unfoldIsland } from "./fold";
import type { SplitLayout } from "./ops";
import { mapPanes, panesOf, type Branch, type Pane } from "./tree";

const docAndAi = (): SplitLayout => ({
  root: {
    kind: "split",
    direction: "row",
    sizes: [0.6, 0.4],
    children: [
      { kind: "pane", id: "d", tabs: ["a.md", "b.md"], front: "b.md" },
      { kind: "pane", id: "p", tabs: ["ai-1", "ai-2"], front: "ai-2" },
    ],
  },
  focus: "d",
});
const isPanel = (p: Pane) => p.tabs.every((t) => t.startsWith("ai"));
const shape = (l: SplitLayout) =>
  panesOf(l.root).map((p) => `${p.tabs.join(",")}>${p.front}`);

describe("folding a panel's island", () => {
  it("joins the panel's tabs to the island beside it, which keeps its front", () => {
    const out = foldIsland(docAndAi(), isPanel, 900)!;
    expect(shape(out.layout)).toEqual(["a.md,b.md,ai-1,ai-2>b.md"]);
    expect(out.folded).toMatchObject({ into: "d", side: "right", need: 900 });
  });

  it("folds a split of documents when no panel is left, the one in use shown", () => {
    const two: SplitLayout = { ...docAndAi(), focus: "p" };
    const out = foldIsland(two, () => false, 900)!;
    expect(shape(out.layout)).toEqual(["a.md,b.md,ai-1,ai-2>ai-2"]);
    expect(shape(unfoldIsland(out.layout, out.folded)!)).toEqual([
      "a.md,b.md>b.md",
      "ai-1,ai-2>ai-2",
    ]);
  });

  it("folds twice and puts both back, the first under its own id", () => {
    const three: SplitLayout = {
      root: {
        kind: "split",
        direction: "row",
        sizes: [0.4, 0.3, 0.3],
        children: [
          { kind: "pane", id: "d1", tabs: ["a.md"], front: "a.md" },
          { kind: "pane", id: "d2", tabs: ["b.md"], front: "b.md" },
          { kind: "pane", id: "p", tabs: ["ai-1"], front: "ai-1" },
        ],
      },
      focus: "d1",
    };
    const first = foldIsland(three, isPanel, 900)!;
    const second = foldIsland(first.layout, isPanel, 800)!;
    expect(shape(second.layout)).toEqual(["a.md,b.md,ai-1>a.md"]);
    const one = unfoldIsland(second.layout, second.folded)!;
    const both = unfoldIsland(one, first.folded)!;
    expect(shape(both)).toEqual(["a.md>a.md", "b.md>b.md", "ai-1>ai-1"]);
  });

  it("keeps the folded tab the user went to in front, and in use", () => {
    const { layout, folded } = foldIsland(docAndAi(), () => false, 900)!;
    const picked: SplitLayout = {
      ...layout,
      root: mapPanes(layout.root, (p) => ({ ...p, front: "ai-1" })) as Branch,
    };
    const back = unfoldIsland(picked, folded)!;
    expect(shape(back)).toEqual(["a.md,b.md>b.md", "ai-1,ai-2>ai-1"]);
    expect(back.focus).toBe("p");
  });

  it("never folds an island into the one above it", () => {
    const column: SplitLayout = {
      root: {
        kind: "split",
        direction: "column",
        sizes: [0.5, 0.5],
        children: docAndAi().root.children,
      },
      focus: "d",
    };
    expect(foldIsland(column, isPanel, 900)).toBeNull();
  });

  it("leaves a lone island be", () => {
    const one: SplitLayout = {
      root: {
        kind: "split",
        direction: "row",
        sizes: [1],
        children: [docAndAi().root.children[0]],
      },
      focus: "d",
    };
    expect(foldIsland(one, () => false, 900)).toBeNull();
  });

  it("puts it back on its side, as it was", () => {
    const { layout, folded } = foldIsland(docAndAi(), isPanel, 900)!;
    const back = unfoldIsland(layout, folded)!;
    expect(shape(back)).toEqual(["a.md,b.md>b.md", "ai-1,ai-2>ai-2"]);
    expect(back.focus).toBe("d");
  });

  it("puts back only the tabs still open, and nothing once all are closed", () => {
    const { layout, folded } = foldIsland(docAndAi(), isPanel, 900)!;
    const oneClosed: SplitLayout = {
      ...layout,
      root: {
        ...layout.root,
        children: [
          {
            kind: "pane",
            id: "d",
            tabs: ["a.md", "b.md", "ai-1"],
            front: "b.md",
          },
        ],
      },
    };
    expect(shape(unfoldIsland(oneClosed, folded)!)).toEqual([
      "a.md,b.md>b.md",
      "ai-1>ai-1",
    ]);
    const allClosed: SplitLayout = {
      ...layout,
      root: {
        ...layout.root,
        children: [
          { kind: "pane", id: "d", tabs: ["a.md", "b.md"], front: "b.md" },
        ],
      },
    };
    expect(unfoldIsland(allClosed, folded)).toBeNull();
  });
});
