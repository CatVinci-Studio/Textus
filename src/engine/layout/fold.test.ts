import { describe, expect, it } from "vitest";
import { foldIsland, unfoldIsland } from "./fold";
import type { SplitLayout } from "./ops";
import { panesOf, type Pane } from "./tree";

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
