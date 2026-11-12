import { LCS_MAX_CELLS, lcsSteps, wholeChange } from "../../utils/lcs";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { simplifyChanges, type Change } from "@milkdown/kit/prose/changeset";

/** A change as shown: where it was in the original (A) and is now (B). */
export interface ChangeSpan {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

// Scripts written without spaces between words, where each character
// stands on its own.
const UNSPACED = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

/** The changes to show: grown to whole words (simplifyChanges), except in
 *  Chinese and Japanese, whose characters it reads as one long word, so a
 *  changed character showed as its whole clause rewritten. There the
 *  grown span is narrowed back to the characters that differ. */
export function shownChanges(
  changes: readonly Change[],
  base: ProseNode,
  doc: ProseNode,
): ChangeSpan[] {
  return simplifyChanges(changes, doc).flatMap((c) => narrowed(c, base, doc));
}

function narrowed(c: ChangeSpan, base: ProseNode, doc: ProseNode) {
  const before = blockText(base, c.fromA, c.toA);
  const after = blockText(doc, c.fromB, c.toB);
  if (before === null || after === null) return [c];
  if (!UNSPACED.test(before) && !UNSPACED.test(after)) return [c];
  // Past the diff's budget a span is left as simplifyChanges grew it.
  if (before.length * after.length > LCS_MAX_CELLS) return [c];
  return charChanges(before, after).map((d) => ({
    fromA: c.fromA + d.fromA,
    toA: c.fromA + d.toA,
    fromB: c.fromB + d.fromB,
    toB: c.fromB + d.toB,
  }));
}

/** The text from `from` to `to`, one character per position, when both are
 *  in one paragraph (or other text block); null otherwise. */
function blockText(doc: ProseNode, from: number, to: number) {
  const $from = doc.resolve(from);
  if (!$from.parent.isTextblock || to > $from.end()) return null;
  return doc.textBetween(from, to, "", "￼");
}

/** The runs where `a` and `b` differ, by a longest common subsequence of
 *  their characters. */
export function charChanges(a: string, b: string): ChangeSpan[] {
  const steps =
    lcsSteps(a.length, b.length, (i, j) => a[i] === b[j], "delete") ??
    wholeChange(a.length, b.length);
  const out: ChangeSpan[] = [];
  let i = 0;
  let j = 0;
  let open: { fromA: number; fromB: number } | null = null;
  for (const step of steps) {
    if (step === "same") {
      if (open) out.push({ ...open, toA: i, toB: j });
      open = null;
      i++;
      j++;
      continue;
    }
    open ??= { fromA: i, fromB: j };
    if (step === "delete") i++;
    else j++;
  }
  if (open) out.push({ ...open, toA: i, toB: j });
  return out;
}
