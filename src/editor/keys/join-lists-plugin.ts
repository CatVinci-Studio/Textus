import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, type Transaction } from "@milkdown/kit/prose/state";
import { canJoin, Mapping, type Mappable } from "@milkdown/kit/prose/transform";
import { typedByUser } from "../change-source";
import { $prose } from "@milkdown/kit/utils";

/**
 * Two lists of a kind that an edit brought together are one list again:
 * deleting what stood between them (a task's line taken back to text and
 * then removed) left two, which Markdown can only write with two markers.
 * Lists the file keeps apart were already touching, and stay so.
 */

const LISTS = new Set(["bullet_list", "ordered_list"]);

/** Where lists of a kind meet, side by side, at a place in [from, to]. */
function meetings(doc: ProseNode, from: number, to: number): number[] {
  const found: number[] = [];
  const look = (parent: ProseNode, start: number) => {
    let before: ProseNode | null = null;
    parent.forEach((child, offset) => {
      const pos = start + offset;
      if (meet(before, child) && pos >= from && pos <= to) found.push(pos);
      before = child;
    });
  };
  look(doc, 0);
  const size = doc.content.size;
  doc.nodesBetween(Math.min(from, size), Math.min(to, size), (node, pos) => {
    if (node.isTextblock) return false;
    look(node, pos + 1);
    return true;
  });
  return found;
}

const meet = (
  a: ProseNode | null | undefined,
  b: ProseNode | null | undefined,
) => !!a && !!b && LISTS.has(a.type.name) && a.type === b.type;

/** Lists already met at `pos` of `doc`. */
function metAt(doc: ProseNode, pos: number): boolean {
  if (pos < 0 || pos > doc.content.size) return false;
  const $pos = doc.resolve(pos);
  return meet($pos.nodeBefore, $pos.nodeAfter);
}

/** Where `next` has lists meeting that didn't meet in `was`, in the part
 *  an edit changed; `back` maps a place in `next` to `was`. */
function listsToJoin(
  was: ProseNode,
  next: ProseNode,
  back: Mappable,
): number[] {
  const start = next.content.findDiffStart(was.content);
  const end = next.content.findDiffEnd(was.content);
  if (start == null || !end) return [];
  // `a` is the end in `next`, the receiver; `b` would be `was`'s.
  return meetings(next, start, Math.max(start, end.a)).filter(
    (pos) => !metAt(was, back.map(pos, -1)) && !metAt(was, back.map(pos, 1)),
  );
}

export function joinListsAfter(
  was: ProseNode,
  tr: Transaction,
  back: Mappable,
): Transaction | null {
  const at = listsToJoin(was, tr.doc, back).filter((pos) =>
    canJoin(tr.doc, pos),
  );
  if (!at.length) return null;
  // Last first: an earlier join moves what follows it.
  for (const pos of at.reverse()) tr.join(pos);
  return tr;
}

export const joinListsPlugin = $prose(
  () =>
    new Plugin({
      appendTransaction(trs, oldState, newState) {
        // Only the writer's own edits: undo gives back what was, and text
        // put in whole (a paste, a plugin's, the AI's, the file's from
        // disk) is as its writer had it, lists apart included.
        if (!trs.some((tr) => tr.docChanged) || !trs.every(typedByUser))
          return null;
        const mapping = new Mapping();
        for (const tr of trs) mapping.appendMapping(tr.mapping);
        return joinListsAfter(oldState.doc, newState.tr, mapping.invert());
      },
    }),
);
