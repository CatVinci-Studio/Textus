import { afterEach, describe, expect, it } from "vitest";
import {
  activateTab,
  arrangeBranch,
  documentInFront,
  openBeside,
  reorderInPane,
  resetWindowModelForTests,
  setTabOrder,
  subscribeSplit,
  setSplitLayout,
  startWindowTabs,
  setWindowTabs,
  splitLayout,
  tabInUse,
  windowTabs,
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

  it("takes a restored window's order at once, the tabs it doesn't name after them", () => {
    start([["x"], ["a", "b", "c", "d"]]);
    let told = 0;
    const stop = subscribeSplit(() => told++);
    setTabOrder(ids()[1], ["c", "a", "d"]);
    expect(tabs()[1]).toEqual(["c", "a", "d", "b"]);
    expect(told).toBe(1);
    stop();
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

describe("the document in front", () => {
  it("stays the document last in use while a page is, and moves on when it goes", () => {
    setWindowTabs(() => [{ id: "a" }, { id: "b" }, { id: "ai", view: {} }]);
    activateTab("b");
    expect(documentInFront()).toBe("b");
    activateTab("ai");
    expect(documentInFront()).toBe("b");
    setWindowTabs((now) => now.filter((tab) => tab.id !== "b"));
    expect(documentInFront()).toBe("a");
  });

  it("keeps a tab when every one is taken away at once", () => {
    // Putting the AI's tabs away with no document left took the window's
    // last one: what reads the tab in use had nothing to read.
    startWindowTabs<{ id: string; view?: unknown }>(
      [{ id: "ai", view: {} }],
      () => ({ id: "blank" }),
    );
    setWindowTabs(() => []);
    expect(windowTabs()).toEqual([{ id: "blank" }]);
    expect(tabInUse()).toBe("blank");
    expect(documentInFront()).toBe("blank");
  });

  it("closing the tab in use goes back to the one in use before it, not the first", () => {
    setWindowTabs(() => [{ id: "ai", view: {} }, { id: "a" }, { id: "b" }]);
    activateTab("a");
    activateTab("b");
    setWindowTabs((now) => now.filter((tab) => tab.id !== "b"));
    expect(tabInUse()).toBe("a");
  });
});
