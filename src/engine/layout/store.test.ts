import { afterEach, describe, expect, it } from "vitest";
import {
  arrangeBranch,
  openBeside,
  reorderInPane,
  resetWindowModelForTests,
  setSplitLayout,
  setWindowTabs,
  splitLayout,
} from "./store";
import { pairLayout } from "./ops";
import { pane, panesOf, type Branch } from "./tree";
import { movePane, moveTab, splitOff, type SplitLayout } from "./ops";

afterEach(() => resetWindowModelForTests());

/** Each pane's tabs, in reading order. */
const tabs = () => panesOf(splitLayout()!.root).map((p) => p.tabs);
const ids = () => panesOf(splitLayout()!.root).map((p) => p.id);

function start(groups: string[][]) {
  setWindowTabs(() => groups.flat().map((id) => ({ id })));
  const layout = pairLayout("row", groups[0][0], groups[1][0]);
  panesOf(layout.root).forEach((p, i) => (p.tabs = groups[i]));
  setSplitLayout(layout);
}

describe("a pane's own tabs", () => {
  it("reorders a pane's own tabs", () => {
    start([["a"], ["b", "c", "d"]]);
    reorderInPane(ids()[1], "d", 0);
    expect(tabs()[1]).toEqual(["d", "b", "c"]);
  });
});

describe("more panes", () => {
  it("opens beside: into the pane to the right, or a new one there", () => {
    start([["a", "c"], ["b"]]);
    openBeside("c", "a");
    expect(tabs()).toEqual([["a"], ["b", "c"]]);
    openBeside("b", "c");
    expect(tabs()).toEqual([["a"], ["c"], ["b"]]);
  });

  it("moves a divider, holding each side to its least share", () => {
    start([["a"], ["b"]]);
    arrangeBranch([], { index: 0, share: 0.97 });
    expect((splitLayout()!.root as Branch).sizes[0]).toBeCloseTo(0.9);
  });
});

describe("three islands (ops)", () => {
  /** a | b | c, one tab each. */
  function three(): SplitLayout {
    const docs = pairLayout("row", "a", "b");
    return {
      root: {
        kind: "split",
        direction: "row",
        children: [docs.root, pane(["c"])],
        sizes: [0.7, 0.3],
      },
      focus: docs.focus,
    };
  }
  const tabsOf = (l: SplitLayout | null) =>
    panesOf(l!.root).map((p) => p.tabs.join(""));

  it("closes an island its last tab leaves, the one it joined in use", () => {
    const layout = three();
    const [, second] = panesOf(layout.root);
    const next = moveTab(layout, "a", second.id, 0);
    expect(tabsOf(next)).toEqual(["ab", "c"]);
    expect(next!.focus).toBe(second.id);
  });

  it("moves an island beside another, or to the window's edge", () => {
    const layout = three();
    const [first, , last] = panesOf(layout.root);
    expect(tabsOf(movePane(layout, last.id, first.id, "left"))).toEqual([
      "c",
      "a",
      "b",
    ]);
    const below = movePane(layout, first.id, null, "bottom")!;
    expect(below.root.direction).toBe("column");
    expect(tabsOf(below)).toEqual(["b", "c", "a"]);
  });

  it("splits a tab off beside a pane, the new pane in use", () => {
    const layout = three();
    const first = panesOf(layout.root)[0];
    const withC = moveTab(layout, "c", first.id)!;
    const next = splitOff(withC, "c", first.id, "bottom")!;
    expect(tabsOf(next)).toEqual(["a", "c", "b"]);
    expect(next.focus).toBe(panesOf(next.root)[1].id);
  });
});
