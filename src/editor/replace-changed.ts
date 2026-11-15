import type { Fragment } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";

/**
 * `tr` with `old` (the content at `at` in its document) made to read
 * `next`, only the part that differs replaced - down to the character
 * within one line of text, so blocks that didn't change keep their nodes
 * (and what they drew) and a caret in a changed paragraph stays. A change
 * reaching past one line replaces the whole blocks it touches: cut mid-way,
 * a table would be split in two. Null when nothing differs.
 */
export function replaceChanged(
  tr: Transaction,
  old: Fragment,
  next: Fragment,
  at = 0,
): Transaction | null {
  let start = old.findDiffStart(next, at);
  if (start === null) return null;
  let { a, b } = old.findDiffEnd(next, at + old.size, at + next.size)!;
  // Where the two ends cross (a repeat), the replaced span starts at `start`.
  const overlap = start - Math.min(a, b);
  if (overlap > 0) {
    a += overlap;
    b += overlap;
  }
  const whole = tr.doc.type.create(null, next);
  const $from = tr.doc.resolve(start);
  const inLine =
    $from.parent.isTextblock &&
    $from.sameParent(tr.doc.resolve(a)) &&
    whole.resolve(start - at).sameParent(whole.resolve(b - at));
  if (!inLine) {
    const from = start;
    const first = indexAt(old, from - at);
    let before = 0;
    for (let k = 0; k < first; k++) before += old.child(k).nodeSize;
    // Blocks only added, or only taken out, between two blocks: the side
    // with nothing replaces nothing, not the block after the boundary.
    const boundary = before === from - at;
    const last = (f: Fragment, end: number) =>
      boundary && end === from
        ? first - 1
        : indexAt(f, Math.max(end - at - 1, from - at));
    const lastOld = last(old, a);
    const lastNew = last(next, b);
    const span = (f: Fragment, to: number) => {
      let size = 0;
      for (let k = first; k <= to && k < f.childCount; k++)
        size += f.child(k).nodeSize;
      return size;
    };
    start = at + before;
    a = start + span(old, lastOld);
    b = start + span(next, lastNew);
  }
  return tr.replace(start, a, whole.slice(start - at, b - at));
}

/** The index of the child of `f` that `pos` (from its start) falls in. */
function indexAt(f: Fragment, pos: number): number {
  let end = 0;
  for (let i = 0; i < f.childCount; i++) {
    end += f.child(i).nodeSize;
    if (pos < end) return i;
  }
  return f.childCount;
}
