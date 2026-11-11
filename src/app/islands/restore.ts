import { useEffect, useRef } from "react";
import type { DocTab } from "../../document/doc-tabs";
import { getUiState, setUiState } from "../../storage/ui-state";
import { afterStartupRestore } from "../../document/reload-tabs";
import {
  setSplitLayout,
  splitLayout,
  subscribeSplit,
} from "../../engine/layout/store";
import {
  pane,
  panesOf,
  type Branch,
  type LayoutNode,
  type SplitDirection,
} from "../../engine/layout/tree";

/** A split as saved: its branches, and each pane by the path of the
 *  document it showed. */
type SavedNode =
  | { direction: SplitDirection; sizes: number[]; children: SavedNode[] }
  | { path: string };

function readNode(raw: unknown): SavedNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  if (typeof node.path === "string")
    return node.path ? { path: node.path } : null;
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

const paths = (node: SavedNode): string[] =>
  "path" in node ? [node.path] : node.children.flatMap(paths);

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
  if (!node || "path" in node) return null;
  const all = paths(node);
  return new Set(all).size === all.length ? node : null;
}

/** The islands that show a file, as saved: one showing none (a page, a
 *  conversation) is left out, its room shared by the rest. */
function saveNode(
  node: LayoutNode,
  pathOf: (id: string) => string | null,
): SavedNode | null {
  if (node.kind === "pane") {
    const path = node.front && pathOf(node.front);
    return path ? { path } : null;
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

function build(node: SavedNode, idOf: Map<string, string>): LayoutNode {
  if ("path" in node) return pane([idOf.get(node.path)!]);
  return {
    kind: "split",
    direction: node.direction,
    sizes: node.sizes,
    children: node.children.map((c) => build(c, idOf)),
  };
}

/**
 * The last split comes back with the window once all its documents are
 * open again. Until then nothing is saved, so a one-document start can't
 * undo it; once the launch's restore is done (and the tabs it opened
 * drawn), one that didn't come back won't.
 */
export function useSplitRestore(
  tabs: readonly DocTab[],
  activate: (id: string) => void,
): void {
  const saved = useRef<SavedNode | null | undefined>(undefined);
  const settled = useRef(false);
  saved.current ??= readSavedSplit(getUiState("splitLayout"));

  useEffect(() => {
    // This window's split as saved: written only when it changes. Every
    // change of the model (a keystroke) isn't one, and another window's
    // split, saved by that window, stays until this one makes its own.
    const current = () => {
      const layout = splitLayout();
      const pathOf = (id: string) =>
        tabsRef.current.find((tab) => tab.id === id)?.path ?? null;
      const tree = layout && saveNode(layout.root, pathOf);
      return tree && !("path" in tree) ? { tree } : null;
    };
    let written = "";
    const settle = () => {
      if (settled.current) return;
      settled.current = true;
      written = JSON.stringify(current());
    };
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopWaiting = afterStartupRestore(() => {
      frame = requestAnimationFrame(() => (timer = setTimeout(settle)));
    });
    const stop = subscribeSplit(() => {
      if (splitLayout()) settle();
      if (!settled.current) return;
      const value = current();
      const json = JSON.stringify(value);
      if (json === written) return;
      written = json;
      setUiState("splitLayout", value);
    });
    return () => {
      stopWaiting();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      stop();
    };
  }, []);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(() => {
    const want = saved.current;
    if (settled.current || !want) return;
    const idOf = new Map<string, string>();
    for (const path of paths(want)) {
      const id = tabs.find((tab) => tab.path === path)?.id;
      if (!id) return;
      idOf.set(path, id);
    }
    settled.current = true;
    const root = build(want, idOf) as Branch;
    const [first] = panesOf(root);
    // Its first document in front, so the split keeps them all.
    activate(first.front!);
    setSplitLayout({ root, focus: first.id });
  }, [tabs, activate]);
}
