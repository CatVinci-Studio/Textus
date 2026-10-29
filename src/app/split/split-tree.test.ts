import { describe, expect, it } from "vitest";
import {
  pane,
  paneBeside,
  panesOf,
  resizeAt,
  splitGrid,
  splitPane,
  splitWhole,
  swapAt,
  tidy,
  turnAt,
  type Branch,
  type LayoutNode,
} from "./split-tree";

const fronts = (node: LayoutNode) => panesOf(node).map((p) => p.front);

describe("splitting a pane", () => {
  it("adds beside it in a branch running the same way, halving its share", () => {
    const a = pane(["a"]);
    const b = pane(["b"]);
    const root: Branch = {
      kind: "split",
      direction: "row",
      children: [a, b],
      sizes: [0.5, 0.5],
    };
    const next = splitPane(root, b.id, "right", pane(["c"])) as Branch;
    expect(fronts(next)).toEqual(["a", "b", "c"]);
    expect(next.sizes).toEqual([0.5, 0.25, 0.25]);
  });

  it("turns the pane into a branch of the two across the other way", () => {
    const a = pane(["a"]);
    const b = pane(["b"]);
    const root: Branch = {
      kind: "split",
      direction: "row",
      children: [a, b],
      sizes: [0.5, 0.5],
    };
    const next = splitPane(root, b.id, "top", pane(["c"])) as Branch;
    expect(next.children[1]).toMatchObject({
      kind: "split",
      direction: "column",
      sizes: [0.5, 0.5],
    });
    expect(fronts(next)).toEqual(["a", "c", "b"]);
  });
});

describe("splitting beside the whole layout", () => {
  const stacked = (): Branch => ({
    kind: "split",
    direction: "column",
    children: [pane(["a"]), pane(["b"])],
    sizes: [0.5, 0.5],
  });

  it("puts a full-height pane beside panes stacked one above the other", () => {
    const next = splitWhole(stacked(), "right", pane(["c"]));
    expect(next).toMatchObject({ direction: "row", sizes: [0.5, 0.5] });
    expect(next.children[0]).toMatchObject({ direction: "column" });
    expect(fronts(next)).toEqual(["a", "b", "c"]);
  });

  it("adds to a layout running the same way with an even share", () => {
    const next = splitWhole(stacked(), "top", pane(["c"]));
    expect(fronts(next)).toEqual(["c", "a", "b"]);
    expect(next.sizes.map((s) => +s.toFixed(3))).toEqual([0.333, 0.333, 0.333]);
  });
});

describe("tidy", () => {
  it("drops empty panes, lifts a lone child, and merges a branch of the same way", () => {
    const tree: Branch = {
      kind: "split",
      direction: "row",
      children: [
        pane(["a"]),
        {
          kind: "split",
          direction: "column",
          children: [
            pane([]),
            {
              kind: "split",
              direction: "row",
              children: [pane(["b"]), pane(["c"])],
              sizes: [0.5, 0.5],
            },
          ],
          sizes: [0.5, 0.5],
        },
      ],
      sizes: [0.5, 0.5],
    };
    const next = tidy(tree) as Branch;
    expect(next.direction).toBe("row");
    expect(fronts(next)).toEqual(["a", "b", "c"]);
    expect(next.sizes).toEqual([0.5, 0.25, 0.25]);
    expect(tidy(pane([]))).toBeNull();
  });
});

describe("resizing and arranging", () => {
  const root = (): Branch => ({
    kind: "split",
    direction: "row",
    children: [pane(["a"]), pane(["b"]), pane(["c"])],
    sizes: [0.4, 0.4, 0.2],
  });

  it("moves one boundary between its two children only, each keeping its least", () => {
    const next = resizeAt(root(), [], 0, 0.25) as Branch;
    expect(next.sizes.map((s) => +s.toFixed(3))).toEqual([0.2, 0.6, 0.2]);
    const squeezed = resizeAt(root(), [], 1, 1) as Branch;
    expect(squeezed.sizes.map((s) => +s.toFixed(3))).toEqual([0.4, 0.5, 0.1]);
  });

  it("turns a branch, and swaps the two children either side of a boundary", () => {
    expect((turnAt(root(), []) as Branch).direction).toBe("column");
    const swapped = swapAt(root(), [], 1) as Branch;
    expect(fronts(swapped)).toEqual(["a", "c", "b"]);
    expect(swapped.sizes).toEqual([0.4, 0.2, 0.4]);
  });
});

describe("the pane beside", () => {
  it("finds the neighbour in a branch running that way, and none across", () => {
    const a = pane(["a"]);
    const b = pane(["b"]);
    const c = pane(["c"]);
    const root: Branch = {
      kind: "split",
      direction: "row",
      children: [
        a,
        {
          kind: "split",
          direction: "column",
          children: [b, c],
          sizes: [0.5, 0.5],
        },
      ],
      sizes: [0.5, 0.5],
    };
    expect(paneBeside(root, a.id, "right")?.front).toBe("b");
    expect(paneBeside(root, b.id, "bottom")?.front).toBe("c");
    expect(paneBeside(root, b.id, "right")).toBeUndefined();
  });
});

describe("the grid", () => {
  it("gives each pane its cells, an auto row for each tab bar's edge", () => {
    const a = pane(["a"]);
    const b = pane(["b"]);
    const c = pane(["c"]);
    // a | (b over c)
    const root: Branch = {
      kind: "split",
      direction: "row",
      children: [
        a,
        {
          kind: "split",
          direction: "column",
          children: [b, c],
          sizes: [0.5, 0.5],
        },
      ],
      sizes: [0.5, 0.5],
    };
    const grid = splitGrid(root);
    expect(grid.column.gridTemplateColumns).toBe(
      "minmax(0, 0.5fr) minmax(0, 0.5fr)",
    );
    expect(grid.column.gridTemplateRows).toBe(
      "max-content minmax(0, 0.5fr) max-content minmax(0, 0.5fr)",
    );
    expect(grid.bars.get(a.id)).toEqual({
      gridColumn: "1 / 2",
      gridRow: "1 / 2",
    });
    expect(grid.bodies.get(a.id)).toEqual({
      gridColumn: "1 / 2",
      gridRow: "2 / 5",
    });
    expect(grid.bars.get(c.id)).toEqual({
      gridColumn: "2 / 3",
      gridRow: "3 / 4",
    });
    expect(grid.bodies.get(c.id)).toEqual({
      gridColumn: "2 / 3",
      gridRow: "4 / 5",
    });
    expect([...grid.top]).toEqual([a.id, b.id]);
    expect(grid.dividers.map((d) => d.style)).toEqual([
      { gridColumn: "2 / span 1", gridRow: "1 / 5" },
      { gridColumn: "2 / 3", gridRow: "3 / span 1" },
    ]);
  });
});
