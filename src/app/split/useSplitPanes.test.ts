import { describe, expect, it } from "vitest";
import { resolveSplit } from "./useSplitPanes";
import { pairLayout, type SplitLayout } from "./split-layout";
import { panesOf } from "./split-tree";

/** Each pane's tabs and the one in front, and which pane is in use. */
function look(layout: ReturnType<typeof resolveSplit>) {
  if (!layout) return null;
  const shown = "blank" in layout ? layout.blank : layout;
  const panes = panesOf(shown.root);
  return {
    blank: "blank" in layout,
    tabs: panes.map((p) => p.tabs),
    fronts: panes.map((p) => p.front),
    focus: panes.findIndex((p) => p.id === shown.focus),
  };
}

function split(groups: string[][], fronts: string[], focus = 0): SplitLayout {
  const layout = pairLayout("row", fronts[0], fronts[1], focus as 0 | 1);
  panesOf(layout.root).forEach((p, i) => (p.tabs = groups[i]));
  return layout;
}

describe("resolveSplit", () => {
  it("pairs the tab in front with the one after it, the rest beside it", () => {
    const ask = { direction: "row" as const };
    expect(look(resolveSplit(null, ask, ["a", "b", "c"], "b"))).toMatchObject({
      tabs: [["a", "b"], ["c"]],
      fronts: ["b", "c"],
    });
    expect(look(resolveSplit(null, ask, ["a"], "a"))).toMatchObject({
      blank: true,
      tabs: [["a"], []],
      focus: 1,
    });
    expect(resolveSplit(null, null, ["a", "b"], "a")).toBeNull();
  });

  it("splits the pane in use again, a tab of its own going into the new pane", () => {
    const layout = split([["a", "c"], ["b"]], ["a", "b"]);
    const down = { direction: "column" as const };
    expect(look(resolveSplit(layout, down, ["a", "b", "c"], "a"))).toEqual({
      blank: false,
      tabs: [["a"], ["c"], ["b"]],
      fronts: ["a", "c", "b"],
      focus: 0,
    });
    // One tab in it: a blank one comes.
    expect(
      look(resolveSplit(layout, down, ["a", "b", "c"], "b")),
    ).toMatchObject({ blank: true, tabs: [["a", "c"], ["b"], []], focus: 2 });
  });

  it("shows the tab in front in its own pane, and opens new tabs in the pane in use", () => {
    const layout = split([["a", "c"], ["b"]], ["a", "b"]);
    expect(resolveSplit(layout, null, ["a", "b", "c"], "a")).toBe(layout);
    expect(
      look(resolveSplit(layout, null, ["a", "b", "c"], "c")),
    ).toMatchObject({ fronts: ["c", "b"] });
    const second = split([["a"], ["b"]], ["a", "b"], 1);
    expect(
      look(resolveSplit(second, null, ["a", "b", "n"], "n")),
    ).toMatchObject({
      tabs: [["a"], ["b", "n"]],
      fronts: ["a", "n"],
      focus: 1,
    });
  });

  it("takes the blank tab into the pane waiting for it, and ends when a pane has no tabs", () => {
    const waiting = pairLayout("row", "a", null, 1);
    expect(look(resolveSplit(waiting, null, ["a", "n"], "n"))).toMatchObject({
      tabs: [["a"], ["n"]],
      fronts: ["a", "n"],
      focus: 1,
    });
    expect(
      resolveSplit(split([["a"], ["b"]], ["a", "b"]), null, ["a"], "a"),
    ).toBeNull();
  });

  it("shows another of a pane's tabs when the one shown closes", () => {
    const layout = split([["a"], ["b", "c"]], ["a", "c"]);
    expect(look(resolveSplit(layout, null, ["a", "b"], "a"))).toMatchObject({
      tabs: [["a"], ["b"]],
      fronts: ["a", "b"],
    });
  });
});
