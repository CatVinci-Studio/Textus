import { describe, expect, it } from "vitest";
import type { LayoutNode, Pane } from "../layout/tree";
import { leastWidth, solveIslands, type IslandsInput } from "./solve";
import { islandRule } from "./island-rules";

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

  it("an island under another keeps no room for a tablet's status bar", () => {
    const stacked: LayoutNode = {
      kind: "split",
      direction: "column",
      children: [pane("a"), pane("b")],
      sizes: [1, 1],
    };
    const { islands } = solveIslands({
      ...input(stacked),
      rowHeight: 64,
      innerRowHeight: 40,
    });
    expect(islands.get("a")!.row!.h).toBe(64);
    expect(islands.get("b")!.row!.h).toBe(40);
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
    expect(dividers[0].fixed).toBe("after");
    // A column only of panels is fixed as one: its divider sizes it too.
    const column: LayoutNode = {
      kind: "split",
      direction: "row",
      children: [
        pane("doc"),
        {
          kind: "split",
          direction: "column",
          children: [pane("ai"), pane("settings")],
          sizes: [0.5, 0.5],
        },
      ],
      sizes: [0.5, 0.5],
    };
    expect(solveIslands(input(column)).dividers[0].fixed).toBe("after");
    // Two panels side by side: nothing to share, the divider is a gap.
    const panels: LayoutNode = {
      kind: "split",
      direction: "row",
      children: [pane("ai"), pane("settings")],
      sizes: [0.5, 0.5],
    };
    expect(solveIslands(input(panels)).dividers[0].fixed).toBe("both");
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

  it("a panel keeps the least width its content measured, past its usual width", () => {
    const root: LayoutNode = {
      kind: "split",
      direction: "row",
      children: [pane("doc"), pane("settings")],
      sizes: [0.5, 0.5],
    };
    const measured = (content: number): IslandsInput => ({
      ...input(root, 900),
      rule: (p, direction) =>
        islandRule(ui.has(p.id), direction, 400, ui.has(p.id) ? content : 0),
    });
    // Narrower content keeps the panel's own width; wider content raises it.
    expect(solveIslands(measured(250)).islands.get("settings")!.sheet.w).toBe(
      400,
    );
    const wide = solveIslands(measured(450)).islands;
    expect(wide.get("settings")!.sheet.w).toBe(450);
    expect(wide.get("doc")!.sheet.w).toBe(900 - 8 - 450);
    expect(leastWidth(measured(450))).toBe(360 + 8 + 450);
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
