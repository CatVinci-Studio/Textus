import type { Fragment } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";

/**
 * `tr` with `old` (the content at `at` in its document) made to read
 * `next`, only the part that differs replaced - down to the character, so
 * blocks that didn't change keep their nodes (and what they drew) and a
 * caret in a changed paragraph stays. Null when nothing differs.
 */
export function replaceChanged(
  tr: Transaction,
  old: Fragment,
  next: Fragment,
  at = 0,
): Transaction | null {
  const start = old.findDiffStart(next, at);
  if (start === null) return null;
  let { a, b } = old.findDiffEnd(next, at + old.size, at + next.size)!;
  // Where the two ends cross (a repeat), the replaced span starts at `start`.
  const overlap = start - Math.min(a, b);
  if (overlap > 0) {
    a += overlap;
    b += overlap;
  }
  const whole = tr.doc.type.create(null, next);
  return tr.replace(start, a, whole.slice(start - at, b - at));
}
