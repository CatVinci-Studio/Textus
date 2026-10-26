import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

/** The ranges of the transaction's new document that its steps wrote,
 *  each mapped through the steps after it. */
export function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  tr.mapping.maps.forEach((map, i) => {
    const after = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) =>
      ranges.push([after.map(newStart, -1), after.map(newEnd, 1)]),
    );
  });
  return ranges;
}

/** The top-level blocks of `doc` that the ranges touch (or end beside),
 *  as [from, to], in document order and each once. */
export function touchedBlocks(
  doc: ProseNode,
  ranges: readonly (readonly [number, number])[],
): [number, number][] {
  const size = doc.content.size;
  const blocks = new Map<number, number>();
  for (const [from, to] of ranges)
    doc.nodesBetween(
      Math.max(0, Math.min(from, to) - 1),
      Math.min(size, Math.max(from, to) + 1),
      (node, pos) => {
        blocks.set(pos, pos + node.nodeSize);
        return false;
      },
    );
  return [...blocks].sort((a, b) => a[0] - b[0]);
}

/** Whether `deco` is one of those drawn for the node at [from, to]: they
 *  lie inside it, but a widget at its very start is the node before's (a
 *  node's widget sits at its end, side -1 or 1). */
export function drawnFor(deco: Decoration, from: number, to: number): boolean {
  return deco.from >= from && deco.to <= to && deco.to > from;
}

/**
 * `set`, with what it holds in each of `blocks` (top-level blocks, as
 * touchedBlocks gives them) drawn again: every node in them `match`es,
 * through `decorate`, which has to draw inside the node.
 */
export function redrawBlocks(
  set: DecorationSet,
  doc: ProseNode,
  blocks: readonly [number, number][],
  match: (node: ProseNode) => boolean,
  decorate: (node: ProseNode, pos: number) => Decoration[],
): DecorationSet {
  if (blocks.length === 0) return set;
  const stale: Decoration[] = [];
  const fresh: Decoration[] = [];
  for (const [from, to] of blocks) {
    for (const deco of set.find(from, to))
      if (drawnFor(deco, from, to)) stale.push(deco);
    doc.nodesBetween(from, to, (node, pos) => {
      if (!match(node)) return true;
      fresh.push(...decorate(node, pos));
      return false;
    });
  }
  return set.remove(stale).add(doc, fresh);
}

/**
 * Keeps per-node decorations in step with an edit for the cost of what it
 * touched. Whole top-level blocks are redrawn, so a code block turned into a
 * paragraph drops its token decorations.
 */
export function redecorateChanged(
  set: DecorationSet,
  tr: Transaction,
  match: (node: ProseNode) => boolean,
  decorate: (node: ProseNode, pos: number) => Decoration[],
): DecorationSet {
  if (!tr.docChanged) return set;
  return redrawBlocks(
    set.map(tr.mapping, tr.doc),
    tr.doc,
    touchedBlocks(tr.doc, changedRanges(tr)),
    match,
    decorate,
  );
}

/** Every node `match`es in `doc`, drawn with `decorate`. */
export function decorateAll(
  doc: ProseNode,
  match: (node: ProseNode) => boolean,
  decorate: (node: ProseNode, pos: number) => Decoration[],
): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!match(node)) return true;
    decorations.push(...decorate(node, pos));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}
