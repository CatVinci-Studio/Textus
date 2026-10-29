import type { CSSProperties } from "react";

/**
 * A split window's panes as a tree: a branch lays its children out in a row
 * or a column, each with its share; a pane holds tabs, one of them in
 * front. Pure functions; the store is split-layout.ts.
 */

export type SplitDirection = "row" | "column";

export interface Pane {
  kind: "pane";
  id: string;
  /** Its tab bar's tabs, in order. */
  tabs: string[];
  /** The tab it shows; null while a blank tab opens into it. */
  front: string | null;
}

export interface Branch {
  kind: "split";
  direction: SplitDirection;
  children: LayoutNode[];
  /** Each child's share of the branch; they add up to 1. */
  sizes: number[];
}

export type LayoutNode = Pane | Branch;

/** A node's place in the tree: the child indexes from the root. */
export type Path = number[];

/** Where a drop or Split puts a new pane beside one. */
export type Side = "left" | "right" | "top" | "bottom";

/** The least share of its branch a child keeps. */
export const MIN_SHARE = 0.1;

let made = 0;

export function pane(tabs: string[], front: string | null = tabs[0] ?? null) {
  made += 1;
  return { kind: "pane", id: `pane-${made}`, tabs, front } satisfies Pane;
}

/** The panes, in reading order: left to right, top to bottom. */
export function panesOf(node: LayoutNode): Pane[] {
  return node.kind === "pane" ? [node] : node.children.flatMap(panesOf);
}

export function paneById(node: LayoutNode, id: string): Pane | undefined {
  return panesOf(node).find((p) => p.id === id);
}

export function paneWithTab(node: LayoutNode, tab: string): Pane | undefined {
  return panesOf(node).find((p) => p.tabs.includes(tab));
}

export function nodeAt(node: LayoutNode, path: Path): LayoutNode | undefined {
  let at: LayoutNode | undefined = node;
  for (const i of path) at = at?.kind === "split" ? at.children[i] : undefined;
  return at;
}

/** Every pane passed through `change`, the tree rebuilt around them. */
export function mapPanes(
  node: LayoutNode,
  change: (pane: Pane) => Pane,
): LayoutNode {
  if (node.kind === "pane") return change(node);
  return { ...node, children: node.children.map((c) => mapPanes(c, change)) };
}

/** The branch at `path` passed through `change`. */
export function mapBranch(
  node: LayoutNode,
  path: Path,
  change: (branch: Branch) => Branch,
): LayoutNode {
  if (node.kind === "pane") return node;
  if (!path.length) return change(node);
  const [i, ...rest] = path;
  const children = [...node.children];
  children[i] = mapBranch(children[i], rest, change);
  return { ...node, children };
}

/**
 * The tree without the panes `keep` lets go (by default, those without
 * tabs); a branch left one child gives it its place, and a branch inside
 * one of the same direction joins it, the shares carried over. Null when
 * nothing is left.
 */
export function tidy(
  node: LayoutNode,
  keep: (pane: Pane) => boolean = (p) => p.tabs.length > 0,
): LayoutNode | null {
  if (node.kind === "pane") return keep(node) ? node : null;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const left = tidy(child, keep);
    if (!left) return;
    if (left.kind === "split" && left.direction === node.direction) {
      left.children.forEach((c, j) => {
        children.push(c);
        sizes.push(node.sizes[i] * left.sizes[j]);
      });
    } else {
      children.push(left);
      sizes.push(node.sizes[i]);
    }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...node, children, sizes: sizes.map((s) => s / total) };
}

/**
 * `added` beside pane `id` on `side`. In a branch running the same way it
 * takes half of that pane's share; otherwise the pane becomes a branch of
 * the two, halved.
 */
export function splitPane(
  node: LayoutNode,
  id: string,
  side: Side,
  added: Pane,
): LayoutNode {
  const direction: SplitDirection =
    side === "left" || side === "right" ? "row" : "column";
  const before = side === "left" || side === "top";
  if (node.kind === "pane") {
    if (node.id !== id) return node;
    return {
      kind: "split",
      direction,
      children: before ? [added, node] : [node, added],
      sizes: [0.5, 0.5],
    };
  }
  const at = node.children.findIndex((c) => c.kind === "pane" && c.id === id);
  if (at >= 0 && node.direction === direction) {
    const children = [...node.children];
    const sizes = [...node.sizes];
    const half = sizes[at] / 2;
    children.splice(before ? at : at + 1, 0, added);
    sizes.splice(at, 1, half, half);
    return { ...node, children, sizes };
  }
  return {
    ...node,
    children: node.children.map((c) => splitPane(c, id, side, added)),
  };
}

/** `added` beside the whole layout on `side`: the full height or width,
 *  its share what each of the others would have. */
export function splitWhole(root: LayoutNode, side: Side, added: Pane): Branch {
  const direction: SplitDirection =
    side === "left" || side === "right" ? "row" : "column";
  const before = side === "left" || side === "top";
  const [children, sizes] =
    root.kind === "split" && root.direction === direction
      ? [root.children, root.sizes]
      : [[root], [1]];
  const share = 1 / (children.length + 1);
  const kept = sizes.map((size) => size * (1 - share));
  return {
    kind: "split",
    direction,
    children: before ? [added, ...children] : [...children, added],
    sizes: before ? [share, ...kept] : [...kept, share],
  };
}

/** The pane next to pane `id` on `side`, in the branch it sits in. */
export function paneBeside(
  node: LayoutNode,
  id: string,
  side: Side,
): Pane | undefined {
  if (node.kind === "pane") return undefined;
  const direction = side === "left" || side === "right" ? "row" : "column";
  const step = side === "left" || side === "top" ? -1 : 1;
  const at = node.children.findIndex((c) => c.kind === "pane" && c.id === id);
  if (at >= 0) {
    const next = node.children[at + step];
    return node.direction === direction && next
      ? panesOf(next)[step > 0 ? 0 : panesOf(next).length - 1]
      : undefined;
  }
  for (const child of node.children) {
    const found = paneBeside(child, id, side);
    if (found) return found;
  }
  return undefined;
}

/** The boundary after child `index` of the branch at `path`, moved to
 *  `share` of the two children it parts; each keeps MIN_SHARE. */
export function resizeAt(
  node: LayoutNode,
  path: Path,
  index: number,
  share: number,
): LayoutNode {
  return mapBranch(node, path, (branch) => {
    const sizes = [...branch.sizes];
    const pair = sizes[index] + sizes[index + 1];
    const least = Math.min(MIN_SHARE, pair / 2);
    const first = Math.min(pair - least, Math.max(least, share * pair));
    sizes[index] = first;
    sizes[index + 1] = pair - first;
    return { ...branch, sizes };
  });
}

/** The branch at `path` laid out the other way. */
export function turnAt(node: LayoutNode, path: Path): LayoutNode {
  return mapBranch(node, path, (b) => ({
    ...b,
    direction: b.direction === "row" ? "column" : "row",
  }));
}

/** The two children either side of boundary `index` of the branch at
 *  `path` swapped, each keeping its share. */
export function swapAt(
  node: LayoutNode,
  path: Path,
  index: number,
): LayoutNode {
  return mapBranch(node, path, (b) => {
    const children = [...b.children];
    const sizes = [...b.sizes];
    [children[index], children[index + 1]] = [
      children[index + 1],
      children[index],
    ];
    [sizes[index], sizes[index + 1]] = [sizes[index + 1], sizes[index]];
    return { ...b, children, sizes };
  });
}

/** A share of the whole window's document area. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A line between two children of a branch. */
export interface Divider {
  path: Path;
  /** It follows child `index`. */
  index: number;
  direction: SplitDirection;
  /** The cut it sits on, and the span it runs along. */
  at: number;
  from: number;
  to: number;
}

function layOut(
  node: LayoutNode,
  box: Box,
  path: Path,
  panes: Map<string, Box>,
  lines: Divider[],
) {
  if (node.kind === "pane") {
    panes.set(node.id, box);
    return;
  }
  const row = node.direction === "row";
  let offset = row ? box.x : box.y;
  node.children.forEach((child, i) => {
    const size = node.sizes[i] * (row ? box.w : box.h);
    const part = row
      ? { x: offset, y: box.y, w: size, h: box.h }
      : { x: box.x, y: offset, w: box.w, h: size };
    layOut(child, part, [...path, i], panes, lines);
    offset += size;
    if (i < node.children.length - 1)
      lines.push({
        path,
        index: i,
        direction: node.direction,
        at: offset,
        from: row ? box.y : box.x,
        to: row ? box.y + box.h : box.x + box.w,
      });
  });
}

/** Cuts closer than this are the same line. */
const near = (n: number) => Math.round(n * 1e6) / 1e6;

export interface SplitGrid {
  column: CSSProperties;
  /** Each pane's tab bar and document. */
  bars: Map<string, CSSProperties>;
  bodies: Map<string, CSSProperties>;
  /** The panes along the window's top edge: their bars clear the window
   *  bar. */
  top: Set<string>;
  dividers: { line: Divider; style: CSSProperties }[];
}

/**
 * The tree as one grid over the document column, so every tab's editor
 * stays a child of it wherever its pane sits. Each cut is a grid line;
 * where a pane's top edge is, a row as tall as its tab bar holds it.
 */
export function splitGrid(root: LayoutNode): SplitGrid {
  const boxes = new Map<string, Box>();
  const lines: Divider[] = [];
  layOut(root, { x: 0, y: 0, w: 1, h: 1 }, [], boxes, lines);
  const all = [...boxes.values()];
  const xs = [...new Set(all.flatMap((b) => [near(b.x), near(b.x + b.w)]))];
  const ys = [...new Set(all.flatMap((b) => [near(b.y), near(b.y + b.h)]))];
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const tops = new Set(all.map((b) => near(b.y)));
  const columns = xs.slice(1).map((x, i) => `minmax(0, ${near(x - xs[i])}fr)`);
  const rows: string[] = [];
  // The line each y cut starts at, and its bar's row where a pane starts.
  const lineAt = new Map<number, number>();
  const barRow = new Map<number, number>();
  ys.forEach((y, i) => {
    lineAt.set(y, rows.length + 1);
    if (i === ys.length - 1) return;
    if (tops.has(y)) {
      barRow.set(y, rows.length + 1);
      rows.push("max-content");
    }
    rows.push(`minmax(0, ${near(ys[i + 1] - y)}fr)`);
  });
  const colLine = (x: number) => xs.indexOf(near(x)) + 1;
  const bars = new Map<string, CSSProperties>();
  const bodies = new Map<string, CSSProperties>();
  const top = new Set<string>();
  for (const [id, b] of boxes) {
    const gridColumn = `${colLine(b.x)} / ${colLine(b.x + b.w)}`;
    const bar = barRow.get(near(b.y))!;
    bars.set(id, { gridColumn, gridRow: `${bar} / ${bar + 1}` });
    bodies.set(id, {
      gridColumn,
      gridRow: `${bar + 1} / ${lineAt.get(near(b.y + b.h))}`,
    });
    if (near(b.y) === 0) top.add(id);
  }
  const dividers = lines.map((line) => ({
    line,
    style:
      line.direction === "row"
        ? {
            gridColumn: `${colLine(line.at)} / span 1`,
            gridRow: `${lineAt.get(near(line.from))} / ${lineAt.get(near(line.to))}`,
          }
        : {
            gridColumn: `${colLine(line.from)} / ${colLine(line.to)}`,
            gridRow: `${lineAt.get(near(line.at))} / span 1`,
          },
  }));
  return {
    column: {
      gridTemplateColumns: columns.join(" "),
      gridTemplateRows: rows.join(" "),
    },
    bars,
    bodies,
    top,
    dividers,
  };
}
