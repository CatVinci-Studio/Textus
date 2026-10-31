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

// Past this many character pairs a span is left as simplifyChanges grew it.
const MAX_CELLS = 250_000;

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
  if (before.length * after.length > MAX_CELLS) return [c];
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
  const n = a.length;
  const m = b.length;
  // lcs[i][j]: the common length of a[i..] and b[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: ChangeSpan[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const start = { fromA: i, fromB: j };
    while ((i < n || j < m) && !(i < n && j < m && a[i] === b[j])) {
      if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) i++;
      else j++;
    }
    out.push({ ...start, toA: i, toB: j });
  }
  return out;
}
