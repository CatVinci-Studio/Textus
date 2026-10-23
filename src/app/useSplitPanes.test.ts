import { describe, expect, it } from "vitest";
import { resolveSplit } from "./useSplitPanes";
import type { SplitLayout } from "./split-layout";

const row = (a: string, b: string | null): SplitLayout => ({
  direction: "row",
  panes: [a, b],
  ratio: 0.5,
});

describe("resolveSplit", () => {
  it("pairs the tab in front with the one after it, or before it", () => {
    const ask = { direction: "row" as const };
    expect(resolveSplit(null, ask, ["a", "b", "c"], "b", 0)).toEqual(
      row("b", "c"),
    );
    expect(resolveSplit(null, ask, ["a", "b"], "b", 0)).toEqual(row("b", "a"));
    expect(resolveSplit(null, ask, ["a"], "a", 0)).toBe("blank");
    expect(resolveSplit(null, null, ["a", "b"], "a", 0)).toBeNull();
  });

  it("puts a tab brought to the front in the pane it was chosen from", () => {
    const layout = row("a", "b");
    expect(resolveSplit(layout, null, ["a", "b", "c"], "a", 0)).toBe(layout);
    expect(resolveSplit(layout, null, ["a", "b", "c"], "c", 0)).toEqual(
      row("c", "b"),
    );
    expect(resolveSplit(layout, null, ["a", "b", "c"], "c", 1)).toEqual(
      row("a", "c"),
    );
  });

  it("takes the blank tab into the second pane, and ends with a pane's tab", () => {
    expect(resolveSplit(row("a", null), null, ["a"], "a", 0)).toEqual(
      row("a", null),
    );
    expect(resolveSplit(row("a", null), null, ["a", "n"], "n", 0)).toEqual(
      row("a", "n"),
    );
    expect(resolveSplit(row("a", "b"), null, ["a"], "a", 0)).toBeNull();
    expect(resolveSplit(row("a", "b"), null, ["b"], "b", 1)).toBeNull();
  });
});
