import { afterEach, describe, expect, it } from "vitest";
import {
  arrangeSplit,
  closeSplit,
  moveToPane,
  openBeside,
  pairLayout,
  reorderInPane,
  setSplitLayout,
  splitLayout,
} from "./split-layout";

afterEach(() => closeSplit());

describe("arrangeSplit", () => {
  it("swaps the panes with their tabs and sets the first one's share, clamped", () => {
    setSplitLayout({
      ...pairLayout("row", "a", "b"),
      groups: [["a", "c"], ["b"]],
    });
    arrangeSplit({ swap: true });
    expect(splitLayout()).toMatchObject({
      panes: ["b", "a"],
      groups: [["b"], ["a", "c"]],
      focus: 1,
      ratio: 0.5,
    });
    arrangeSplit({ ratio: 0.95 });
    expect(splitLayout()?.ratio).toBe(0.8);
  });

  it("does nothing with one document", () => {
    arrangeSplit({ swap: true, ratio: 0.3 });
    expect(splitLayout()).toBeNull();
  });
});

describe("moving tabs between panes", () => {
  it("moves a tab into the other pane, in front there", () => {
    setSplitLayout({
      ...pairLayout("row", "a", "b"),
      groups: [["a", "c"], ["b"]],
    });
    moveToPane("c", 1);
    expect(splitLayout()).toMatchObject({
      groups: [["a"], ["b", "c"]],
      panes: ["a", "c"],
      focus: 1,
    });
    openBeside("a", "c");
    expect(splitLayout()?.groups).toEqual([["a"], ["b", "c"]]);
    openBeside("b", "a");
    expect(splitLayout()?.groups).toEqual([["a"], ["c", "b"]]);
  });

  it("reorders a pane's own tabs", () => {
    setSplitLayout({
      ...pairLayout("row", "a", "b"),
      groups: [["a"], ["b", "c", "d"]],
    });
    reorderInPane(1, "d", 0);
    expect(splitLayout()?.groups[1]).toEqual(["d", "b", "c"]);
  });
});
