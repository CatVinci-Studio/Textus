import { describe, expect, it } from "vitest";
import { resolveSplit } from "./useSplitPanes";
import { pairLayout, type SplitLayout } from "./split-layout";

const split = (
  groups: [string[], string[]],
  panes: [string, string | null],
  focus: 0 | 1 = 0,
): SplitLayout => ({ direction: "row", ratio: 0.5, groups, panes, focus });

describe("resolveSplit", () => {
  it("pairs the tab in front with the one after it, the rest beside it", () => {
    const ask = { direction: "row" as const };
    expect(resolveSplit(null, ask, ["a", "b", "c"], "b")).toEqual(
      split([["a", "b"], ["c"]], ["b", "c"]),
    );
    expect(resolveSplit(null, ask, ["a", "b"], "b")).toEqual(
      split([["b"], ["a"]], ["b", "a"]),
    );
    expect(resolveSplit(null, ask, ["a"], "a")).toBe("blank");
    expect(resolveSplit(null, null, ["a", "b"], "a")).toBeNull();
  });

  it("shows the tab in front in its own pane, and opens new tabs in the pane in use", () => {
    const layout = split([["a", "c"], ["b"]], ["a", "b"]);
    expect(resolveSplit(layout, null, ["a", "b", "c"], "a")).toBe(layout);
    expect(resolveSplit(layout, null, ["a", "b", "c"], "c")).toEqual(
      split([["a", "c"], ["b"]], ["c", "b"]),
    );
    const second = split([["a"], ["b"]], ["a", "b"], 1);
    expect(resolveSplit(second, null, ["a", "b", "n"], "n")).toEqual(
      split([["a"], ["b", "n"]], ["a", "n"], 1),
    );
  });

  it("takes the blank tab into the second pane, and ends when a pane has no tabs", () => {
    const waiting = pairLayout("row", "a", null, 1);
    expect(resolveSplit(waiting, null, ["a"], "a")).toBe(waiting);
    expect(resolveSplit(waiting, null, ["a", "n"], "n")).toEqual(
      split([["a"], ["n"]], ["a", "n"], 1),
    );
    expect(
      resolveSplit(split([["a"], ["b"]], ["a", "b"]), null, ["a"], "a"),
    ).toBeNull();
    expect(
      resolveSplit(split([["a"], ["b"]], ["a", "b"]), null, ["b"], "b"),
    ).toBeNull();
  });

  it("shows another of a pane's tabs when the one shown closes", () => {
    const layout = split([["a"], ["b", "c"]], ["a", "c"]);
    expect(resolveSplit(layout, null, ["a", "b"], "a")).toEqual(
      split([["a"], ["b"]], ["a", "b"]),
    );
  });
});
