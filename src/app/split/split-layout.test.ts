import { afterEach, describe, expect, it } from "vitest";
import {
  arrangeBranch,
  closeSplit,
  moveToPane,
  openBeside,
  pairLayout,
  reorderInPane,
  setSplitLayout,
  splitBeside,
  splitLayout,
} from "./split-layout";
import { aiPane, islandOf, panesOf, type Branch } from "./split-tree";
import {
  focusOn,
  movePane,
  moveTab,
  splitOff,
  type SplitLayout,
} from "./layout-ops";

afterEach(() => closeSplit());

/** Each pane's tabs, in reading order. */
const tabs = () => panesOf(splitLayout()!.root).map((p) => p.tabs);
const fronts = () => panesOf(splitLayout()!.root).map((p) => p.front);
const ids = () => panesOf(splitLayout()!.root).map((p) => p.id);

function start(groups: string[][]) {
  const layout = pairLayout("row", groups[0][0], groups[1][0]);
  panesOf(layout.root).forEach((p, i) => (p.tabs = groups[i]));
  setSplitLayout(layout);
}

describe("moving tabs between panes", () => {
  it("moves a tab into another pane, in front there and that pane in use", () => {
    start([["a", "c"], ["b"]]);
    moveToPane("c", ids()[1]);
    expect(tabs()).toEqual([["a"], ["b", "c"]]);
    expect(fronts()).toEqual(["a", "c"]);
    expect(splitLayout()?.focus).toBe(ids()[1]);
  });

  it("ends the split when a pane is left without tabs", () => {
    start([["a"], ["b"]]);
    moveToPane("a", ids()[1]);
    expect(splitLayout()).toBeNull();
  });

  it("reorders a pane's own tabs", () => {
    start([["a"], ["b", "c", "d"]]);
    reorderInPane(ids()[1], "d", 0);
    expect(tabs()[1]).toEqual(["d", "b", "c"]);
  });
});

describe("more panes", () => {
  it("splits a pane on any side, a third pane beside or below", () => {
    start([["a"], ["b", "c", "d"]]);
    splitBeside("c", ids()[1], "right");
    expect(tabs()).toEqual([["a"], ["b", "d"], ["c"]]);
    splitBeside("d", ids()[1], "bottom");
    expect(tabs()).toEqual([["a"], ["b"], ["d"], ["c"]]);
    const root = splitLayout()!.root;
    expect(root.children[1]).toMatchObject({
      kind: "split",
      direction: "column",
    });
  });

  it("opens beside: into the pane to the right, or a new one there", () => {
    start([["a", "c"], ["b"]]);
    openBeside("c", "a");
    expect(tabs()).toEqual([["a"], ["b", "c"]]);
    openBeside("b", "c");
    expect(tabs()).toEqual([["a"], ["c"], ["b"]]);
  });

  it("turns, swaps and resizes one branch", () => {
    start([["a"], ["b"]]);
    arrangeBranch([], { swap: 0 });
    expect(fronts()).toEqual(["b", "a"]);
    arrangeBranch([], { index: 0, share: 0.97 });
    expect((splitLayout()!.root as Branch).sizes[0]).toBeCloseTo(0.9);
    arrangeBranch([], "turn");
    expect(splitLayout()!.root.direction).toBe("column");
  });
});

describe("islands of two kinds (layout-ops)", () => {
  /** Documents a | b, the AI island on the right. */
  function withAi(): SplitLayout {
    const docs = pairLayout("row", "a", "b");
    const ai = aiPane();
    return {
      root: {
        kind: "split",
        direction: "row",
        children: [docs.root, ai],
        sizes: [0.7, 0.3],
      },
      focus: docs.focus,
    };
  }
  const kinds = (l: SplitLayout | null) =>
    panesOf(l!.root).map((p) => [islandOf(p), p.tabs.join("")]);

  it("never moves a document into the AI island", () => {
    const layout = withAi();
    const ai = panesOf(layout.root)[2].id;
    expect(moveTab(layout, "a", ai)).toBe(layout);
    expect(focusOn(layout, ai)).toBe(layout);
  });

  it("keeps the AI island when the documents beside it go down to one", () => {
    const layout = withAi();
    const [, second] = panesOf(layout.root);
    const next = moveTab(layout, "a", second.id, 0);
    expect(kinds(next)).toEqual([
      ["documents", "ab"],
      ["ai", ""],
    ]);
    // The AI island is never the pane in use.
    expect(next!.focus).toBe(second.id);
  });

  it("moves an island beside another, or to the window's edge", () => {
    const layout = withAi();
    const [first, , ai] = panesOf(layout.root);
    expect(kinds(movePane(layout, ai.id, first.id, "left"))).toEqual([
      ["ai", ""],
      ["documents", "a"],
      ["documents", "b"],
    ]);
    const below = movePane(layout, first.id, null, "bottom")!;
    expect(below.root.direction).toBe("column");
    expect(kinds(below)).toEqual([
      ["documents", "b"],
      ["ai", ""],
      ["documents", "a"],
    ]);
  });

  it("splits a tab off beside a pane, the new pane in use", () => {
    const layout = moveTab(withAi(), "c", panesOf(withAi().root)[0].id)!;
    const first = panesOf(layout.root)[0];
    const next = splitOff(layout, "c", first.id, "bottom")!;
    expect(kinds(next)).toEqual([
      ["documents", "a"],
      ["documents", "c"],
      ["documents", "b"],
      ["ai", ""],
    ]);
    expect(next.focus).toBe(panesOf(next.root)[1].id);
  });
});
