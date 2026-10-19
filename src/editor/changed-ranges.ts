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

/**
 * Keeps decorations drawn per node (a code block, an inline code span) in
 * step with an edit for the cost of what it touched: `set` is mapped
 * through `tr`, and only around the changed ranges are the old
 * decorations dropped and those of each node `match`es drawn again with
 * `decorate` - rather than every such node in the document on every
 * keystroke.
 */
export function redecorateChanged(
  set: DecorationSet,
  tr: Transaction,
  match: (node: ProseNode) => boolean,
  decorate: (node: ProseNode, pos: number) => Decoration[],
): DecorationSet {
  let next = set.map(tr.mapping, tr.doc);
  const size = tr.doc.content.size;
  for (const [from, to] of changedRanges(tr)) {
    const start = Math.max(0, from - 1);
    const end = Math.min(size, to + 1);
    const stale = next.find(start, end);
    const fresh: Decoration[] = [];
    tr.doc.nodesBetween(start, end, (node, pos) => {
      if (!match(node)) return true;
      stale.push(...next.find(pos, pos + node.nodeSize));
      fresh.push(...decorate(node, pos));
      return false;
    });
    next = next.remove(stale).add(tr.doc, fresh);
  }
  return next;
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
