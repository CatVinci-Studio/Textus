import { pane, type LayoutNode, type SplitDirection } from "./tree";

/** A split as saved: its branches, and each island by its documents'
 *  paths and the one in front (earlier versions: that one alone). */
type SavedNode =
  | { direction: SplitDirection; sizes: number[]; children: SavedNode[] }
  | { paths: string[]; front: string }
  | { path: string };

function readNode(raw: unknown): SavedNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  if (typeof node.path === "string")
    return node.path ? { path: node.path } : null;
  if (Array.isArray(node.paths)) {
    const all = node.paths.filter((p): p is string => typeof p === "string");
    const front = typeof node.front === "string" ? node.front : all[0];
    return all.length && front && all.includes(front)
      ? { paths: all, front }
      : null;
  }
  const { direction, sizes, children } = node;
  if (direction !== "row" && direction !== "column") return null;
  if (!Array.isArray(children) || children.length < 2) return null;
  const read = children.map(readNode);
  if (read.some((c) => !c)) return null;
  const shares =
    Array.isArray(sizes) &&
    sizes.length === read.length &&
    sizes.every((s) => typeof s === "number" && s > 0)
      ? (sizes as number[])
      : read.map(() => 1);
  const total = shares.reduce((a, b) => a + b, 0);
  return {
    direction,
    sizes: shares.map((s) => s / total),
    children: read as SavedNode[],
  };
}

/** Every document a saved split shows, island by island. */
export const savedPaths = (node: SavedNode): string[] =>
  "path" in node
    ? [node.path]
    : "paths" in node
      ? node.paths
      : node.children.flatMap(savedPaths);

/** The split saved, if it is one this window can show: a tree, or the
 *  pair of documents earlier versions kept. */
export function readSavedSplit(raw: unknown): SavedNode | null {
  if (!raw || typeof raw !== "object") return null;
  const old = raw as { direction?: unknown; ratio?: unknown; paths?: unknown };
  const node = Array.isArray(old.paths)
    ? readNode({
        direction: old.direction,
        sizes:
          typeof old.ratio === "number"
            ? [old.ratio, 1 - old.ratio]
            : undefined,
        children: old.paths.map((path) => ({ path })),
      })
    : readNode((raw as { tree?: unknown }).tree);
  if (!node || !("children" in node)) return null;
  const all = savedPaths(node);
  return new Set(all).size === all.length ? node : null;
}

/** The document a saved window had in front: its one island's, or its
 *  first island's when split (the island restored in use). */
export function savedFront(raw: unknown): string | null {
  const tree =
    raw && typeof raw === "object" ? (raw as { tree?: unknown }).tree : null;
  let node = readNode(tree);
  while (node && "children" in node) node = node.children[0];
  return node ? ("path" in node ? node.path : node.front) : null;
}

/** The islands that show files, as saved: their documents, the one in
 *  front first; one showing none (a page, a conversation) is left out, its
 *  room shared by the rest. */
export function saveNode(
  node: LayoutNode,
  pathOf: (id: string) => string | null,
): SavedNode | null {
  if (node.kind === "pane") {
    const all = node.tabs.flatMap((id) => pathOf(id) ?? []);
    const front = (node.front && pathOf(node.front)) || all[0];
    return front ? { paths: all, front } : null;
  }
  const kept = node.children
    .map((c, i) => ({ node: saveNode(c, pathOf), size: node.sizes[i] }))
    .filter((c): c is { node: SavedNode; size: number } => !!c.node);
  if (kept.length < 2) return kept[0]?.node ?? null;
  const total = kept.reduce((sum, c) => sum + c.size, 0);
  return {
    direction: node.direction,
    sizes: kept.map((c) => c.size / total),
    children: kept.map((c) => c.node),
  };
}

/** The saved split as a layout of the tabs `idOf` has; an island none of
 *  whose documents is open is left out, null when none is left. */
export function buildSaved(
  node: SavedNode,
  idOf: ReadonlyMap<string, string>,
): LayoutNode | null {
  if (!("children" in node)) {
    const all = "path" in node ? [node.path] : node.paths;
    const ids = all.flatMap((p) => idOf.get(p) ?? []);
    const front = idOf.get("path" in node ? node.path : node.front);
    return ids.length ? pane(ids, front ?? ids[0]) : null;
  }
  const kept = node.children
    .map((c, i) => ({ node: buildSaved(c, idOf), size: node.sizes[i] }))
    .filter((c): c is { node: LayoutNode; size: number } => !!c.node);
  if (kept.length < 2) return kept[0]?.node ?? null;
  const total = kept.reduce((sum, c) => sum + c.size, 0);
  return {
    kind: "split",
    direction: node.direction,
    sizes: kept.map((c) => c.size / total),
    children: kept.map((c) => c.node),
  };
}
