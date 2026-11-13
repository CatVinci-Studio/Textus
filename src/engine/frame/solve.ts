import type { Divider, LayoutNode, Pane, SplitDirection } from "../layout/tree";
import { distribute, type Priority, type SizeRule } from "./distribute";
import type { Rect } from "./rect";

/**
 * The islands' places in pixels, from the layout tree and the room they
 * have: every island's row of tabs and sheet, and the lines between them.
 * Pure: it reads no page, so the motion and the drag zones use the same
 * numbers the islands are drawn at.
 */

/** One island's parts. `row` is null where islands show no tabs. */
export interface IslandRects {
  row: Rect | null;
  sheet: Rect;
  /** Row and sheet together. */
  whole: Rect;
  /** Under another island, not in the window bar's row. */
  inner: boolean;
}

interface DividerRects {
  line: Divider;
  /** The gap it lies in. */
  rect: Rect;
  /** The extent of the two sides it parts, along its branch. */
  before: { start: number; end: number };
  after: { start: number; end: number };
  /** The side of a fixed width (a panel's island, or a column only of
   *  them), which the divider resizes in pixels; null for two shares;
   *  "both" for two panels, which have nothing to share. */
  fixed: "before" | "after" | "both" | null;
}

export interface IslandsLayout {
  islands: Map<string, IslandRects>;
  dividers: DividerRects[];
}

export interface IslandsInput {
  root: LayoutNode;
  box: Rect;
  gap: number;
  /** A row of tabs' height; 0 with no rows. */
  rowHeight: number;
  /** A pane's rule along `direction`. */
  rule: (
    pane: Pane,
    direction: SplitDirection,
  ) => Omit<SizeRule, "size"> & {
    /** Its width in pixels, for a fixed one. */
    pixels: number;
  };
}

export function solveIslands(input: IslandsInput): IslandsLayout {
  const out: IslandsLayout = { islands: new Map(), dividers: [] };
  place(input, input.root, input.box, [], out);
  return out;
}

/** The least width the islands keep side by side: every island at its
 *  minimum, the gaps between them. */
export function leastWidth(input: Omit<IslandsInput, "box">): number {
  return ruleOf(input as IslandsInput, input.root, "row", 1).min;
}

/** The least height, the same way down the column. */
export function leastHeight(input: Omit<IslandsInput, "box">): number {
  return ruleOf(input as IslandsInput, input.root, "column", 1).min;
}

function island(input: IslandsInput, box: Rect, top: boolean): IslandRects {
  const h = Math.min(input.rowHeight, box.h);
  const row = h ? { x: box.x, y: box.y, w: box.w, h } : null;
  const sheet = { x: box.x, y: box.y + h, w: box.w, h: box.h - h };
  return { row, sheet, whole: box, inner: !top };
}

const PRIORITY_RANK: Record<Priority, number> = { low: 0, normal: 1, high: 2 };

/** A whole subtree's rule along `direction`: across it, the strictest of
 *  its children's. */
function ruleOf(
  input: IslandsInput,
  node: LayoutNode,
  direction: SplitDirection,
  fraction: number,
): SizeRule {
  if (node.kind === "pane") {
    const r = input.rule(node, direction);
    return { ...r, size: r.fixed ? r.pixels : fraction };
  }
  const kids = node.children.map((c, i) =>
    ruleOf(input, c, direction, node.sizes[i]),
  );
  const along = node.direction === direction;
  const fixed = kids.every((k) => k.fixed);
  const sum = (pick: (k: SizeRule) => number) =>
    kids.reduce((a, k) => a + pick(k), 0);
  const most = (pick: (k: SizeRule) => number) => Math.max(...kids.map(pick));
  const priority = kids.reduce<Priority>(
    (best, k) =>
      PRIORITY_RANK[k.priority] > PRIORITY_RANK[best] ? k.priority : best,
    "low",
  );
  return {
    min: along
      ? sum((k) => k.min) + input.gap * (kids.length - 1)
      : most((k) => k.min),
    size: fixed ? (along ? sum((k) => k.size) : most((k) => k.size)) : fraction,
    fixed,
    priority,
  };
}

function place(
  input: IslandsInput,
  node: LayoutNode,
  box: Rect,
  path: number[],
  out: IslandsLayout,
) {
  if (node.kind === "pane") {
    out.islands.set(node.id, island(input, box, box.y === input.box.y));
    return;
  }
  const row = node.direction === "row";
  const gaps = input.gap * (node.children.length - 1);
  const rules = node.children.map((c, i) =>
    ruleOf(input, c, node.direction, node.sizes[i]),
  );
  const lengths = distribute(rules, (row ? box.w : box.h) - gaps);
  let at = row ? box.x : box.y;
  const parts = lengths.map((length) => {
    const start = at;
    at += length + input.gap;
    return { start, end: start + length };
  });
  parts.forEach(({ start, end }, i) => {
    const part = row
      ? { x: start, y: box.y, w: end - start, h: box.h }
      : { x: box.x, y: start, w: box.w, h: end - start };
    place(input, node.children[i], part, [...path, i], out);
    const next = parts[i + 1];
    if (!next) return;
    const line: Divider = {
      path,
      index: i,
      direction: node.direction,
      at: end + input.gap / 2,
      from: row ? box.y : box.x,
      to: row ? box.y + box.h : box.x + box.w,
    };
    out.dividers.push({
      line,
      rect: row
        ? { x: end, y: box.y, w: next.start - end, h: box.h }
        : { x: box.x, y: end, w: box.w, h: next.start - end },
      before: { start, end },
      after: next,
      fixed:
        rules[i].fixed && rules[i + 1].fixed
          ? "both"
          : rules[i].fixed === rules[i + 1].fixed
            ? null
            : rules[i].fixed
              ? "before"
              : "after",
    });
  });
}
