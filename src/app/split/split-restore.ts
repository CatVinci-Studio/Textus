import { useEffect, useRef } from "react";
import type { DocTab } from "../../document/doc-tabs";
import { getUiState, setUiState } from "../../storage/ui-state";
import { setSplitLayout, splitLayout, subscribeSplit } from "./split-layout";
import {
  pane,
  panesOf,
  type Branch,
  type LayoutNode,
  type SplitDirection,
} from "./split-tree";

/** A split as saved: its branches, and each pane by the path of the
 *  document it showed. */
export type SavedNode =
  | { direction: SplitDirection; sizes: number[]; children: SavedNode[] }
  | { path: string };

/** How long after the window opens its last split may still come back:
 *  the documents of the last session open one after another. */
const RESTORE_MS = 8000;

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

function saveNode(
  node: LayoutNode,
  pathOf: (id: string) => string | null,
): SavedNode | null {
  if (node.kind === "pane") {
    const path = node.front && pathOf(node.front);
    return path ? { path } : null;
  }
  const children = node.children.map((c) => saveNode(c, pathOf));
  if (children.some((c) => !c)) return null;
  return {
    direction: node.direction,
    sizes: node.sizes,
    children: children as SavedNode[],
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
 * undo it.
 */
export function useSplitRestore(
  tabs: readonly DocTab[],
  activate: (id: string) => void,
): void {
  const saved = useRef<SavedNode | null | undefined>(undefined);
  const settled = useRef(false);
  saved.current ??= readSavedSplit(getUiState("splitLayout"));

  useEffect(() => {
    const settle = () => (settled.current = true);
    const timer = setTimeout(settle, RESTORE_MS);
    const stop = subscribeSplit(() => {
      const layout = splitLayout();
      if (layout) settle();
      if (!settled.current) return;
      const pathOf = (id: string) =>
        tabsRef.current.find((tab) => tab.id === id)?.path ?? null;
      const tree = layout && saveNode(layout.root, pathOf);
      setUiState("splitLayout", tree ? { tree } : null);
    });
    return () => {
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
