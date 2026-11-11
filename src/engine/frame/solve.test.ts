import { describe, expect, it } from "vitest";
import type { LayoutNode, Pane } from "../layout/tree";
import { leastWidth, solveIslands, type IslandsInput } from "./solve";

const pane = (id: string): Pane => ({
  kind: "pane",
  id,
  tabs: [id],
  front: id,
});
const ui = new Set(["ai", "settings"]);
const input = (root: LayoutNode, w = 1200): IslandsInput => ({
  root,
  box: { x: 0, y: 0, w, h: 800 },
  gap: 8,
  rowHeight: 40,
  rule: (p, direction) =>
    ui.has(p.id) && direction === "row"
      ? { min: 320, pixels: 400, fixed: true, priority: "low" }
      : {
          min: direction === "row" ? 360 : 160,
          pixels: 0,
          fixed: false,
          priority: "high",
        },
});

describe("solveIslands", () => {
  it("one island: its row on top, its sheet under it", () => {
    const one: LayoutNode = {
      kind: "split",
      direction: "row",
      children: [pane("window")],
      sizes: [1],
    };
    const { islands, dividers } = solveIslands(input(one));
    expect(dividers).toEqual([]);
    expect(islands.get("window")).toEqual({
      row: { x: 0, y: 0, w: 1200, h: 40 },
      sheet: { x: 0, y: 40, w: 1200, h: 760 },
      whole: { x: 0, y: 0, w: 1200, h: 800 },
      inner: false,
    });
  });

  it("the AI beside a document keeps its width; the gap holds the divider", () => {
    const root: LayoutNode = {
      kind: "split",
      direction: "row",
      children: [pane("doc"), pane("ai")],
      sizes: [0.5, 0.5],
    };
    const { islands, dividers } = solveIslands(input(root));
    expect(islands.get("ai")!.sheet.w).toBe(400);
    expect(islands.get("doc")!.sheet.w).toBe(792);
    expect(dividers[0].rect).toEqual({ x: 792, y: 0, w: 8, h: 800 });
    expect(dividers[0].before).toEqual({ start: 0, end: 792 });
    expect(dividers[0].after).toEqual({ start: 800, end: 1200 });
  });

  it("stacked islands: the lower one's row is inner, under the gap", () => {
    const root: LayoutNode = {
      kind: "split",
      direction: "column",
      children: [pane("a"), pane("b")],
      sizes: [0.5, 0.5],
    };
    const b = solveIslands(input(root)).islands.get("b")!;
    expect(b.inner).toBe(true);
    expect(b.row).toEqual({ x: 0, y: 404, w: 1200, h: 40 });
    // Its row stands on its sheet's top, not over it.
    expect(b.sheet.y).toBe(b.row!.y + b.row!.h);
  });

  it("a narrow window takes from the AI first, the document kept to its minimum", () => {
    const root: LayoutNode = {
      kind: "split",
      direction: "row",
      children: [pane("doc"), pane("ai")],
      sizes: [0.5, 0.5],
    };
    const { islands } = solveIslands(input(root, 700));
    expect(islands.get("doc")!.sheet.w).toBe(360);
    expect(islands.get("ai")!.sheet.w).toBe(332);
  });

  it("a column of a document and Settings, beside the AI: the column is flexible", () => {
    const root: LayoutNode = {
      kind: "split",
      direction: "row",
      children: [
        {
          kind: "split",
          direction: "column",
          children: [pane("doc"), pane("settings")],
          sizes: [0.5, 0.5],
        },
        pane("ai"),
      ],
      sizes: [0.5, 0.5],
    };
    const { islands } = solveIslands(input(root));
    expect(islands.get("ai")!.sheet.w).toBe(400);
    expect(islands.get("settings")!.sheet.w).toBe(792);
  });

  it("the least width: each island at its minimum, the gaps between", () => {
    const root: LayoutNode = {
      kind: "split",
      direction: "row",
      children: [pane("doc"), pane("ai")],
      sizes: [0.5, 0.5],
    };
    expect(leastWidth(input(root))).toBe(360 + 8 + 320);
    expect(leastWidth(input(pane("one")))).toBe(360);
  });
});
