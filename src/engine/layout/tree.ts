/**
 * A split window's panes - its islands - as a tree: a branch lays its
 * children out in a row or a column, each with its share; a pane holds
 * tabs, one of them in front. Pure functions; the operations on a whole
 * layout are ops.ts, the store store.ts.
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

/** An island stays while it has tabs. */
export const keepsItself = (p: Pane) => p.tabs.length > 0;

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
 * tabs but the AI's); a branch left one child gives it its place, and a branch inside
 * one of the same direction joins it, the shares carried over. Null when
 * nothing is left.
 */
export function tidy(
  node: LayoutNode,
  keep: (pane: Pane) => boolean = keepsItself,
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
 *  its share what each of the others would have, or `share`. */
export function splitWhole(
  root: LayoutNode,
  side: Side,
  added: Pane,
  share?: number,
): Branch {
  const direction: SplitDirection =
    side === "left" || side === "right" ? "row" : "column";
  const before = side === "left" || side === "top";
  const [children, sizes] =
    root.kind === "split" && root.direction === direction
      ? [root.children, root.sizes]
      : [[root], [1]];
  const own = share ?? 1 / (children.length + 1);
  const kept = sizes.map((size) => size * (1 - own));
  return {
    kind: "split",
    direction,
    children: before ? [added, ...children] : [...children, added],
    sizes: before ? [own, ...kept] : [...kept, own],
  };
}

/** Pane `id`'s share of the branch it sits in, and which way that runs. */
export function shareOf(
  node: LayoutNode,
  id: string,
): { direction: SplitDirection; share: number } | null {
  if (node.kind === "pane") return null;
  const at = node.children.findIndex((c) => c.kind === "pane" && c.id === id);
  if (at >= 0) return { direction: node.direction, share: node.sizes[at] };
  for (const child of node.children) {
    const found = shareOf(child, id);
    if (found) return found;
  }
  return null;
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
