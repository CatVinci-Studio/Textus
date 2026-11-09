/** Sentence-level diff for partially accepting a rewrite. Sentences, not
 *  words, as word-level picks make broken grammar; the pieces join back into
 *  the text exactly. */

import { similarity } from "./sentence-similarity";
import { mergeShortParagraphs, regroup, alignRun } from "./paragraph-align";
import { sentencePairs } from "./paragraph-align";

export type SentenceHunk =
  | { kind: "same"; text: string }
  | { kind: "change"; before: string; after: string };

/** A sentence as it is shown on its own: without the whitespace and the
 *  line break (`\` or `<br>`) it carries at its end, which stays the
 *  document's - parsed alone, a trailing `\` is a literal backslash. */
export function trimBreaks(sentence: string): string {
  return sentence
    .trim()
    .replace(/(?:\\|<br\s*\/?>)+$/, "")
    .trim();
}

/** A sentence as drawn in its place: trimBreaks, and without a heading's
 *  `#`s, which would show as text inline. */
export function inlineSentence(sentence: string): string {
  return trimBreaks(sentence).replace(/^#{1,6}[ \t]+/, "");
}

/** Units diffed by LCS, runs of non-matching ones becoming changes.
 *  `alignTail`: `b` is a stream so far; without it every paragraph is
 *  regrouped. */
export function diffSentenceLists(
  a: string[],
  b: string[],
  alignTail?: (
    before: string[],
    after: string[],
  ) => { before: string; after: string }[],
): SentenceHunk[] {
  // A rewrite still streaming in regroups only the paragraphs it has
  // finished: a paragraph's shape can't be judged half written.
  return mergeShortParagraphs(
    regroup(sentencePairs(a, b, alignTail ?? alignRun), !alignTail),
  ).map((p) =>
    p.same
      ? { kind: "same" as const, text: p.after }
      : { kind: "change" as const, before: p.before, after: p.after },
  );
}

/** How many of a change's original sentences its new text stands for; the
 *  rest were dropped, and the new text goes before them so it doesn't move. */
export function pairedPrefix(before: string[], after: string): number {
  if (before.length <= 1 || !after.trim()) return before.length;
  let best = before.length;
  let score = similarity(before.join(""), after);
  for (let k = before.length - 1; k >= 1; k--) {
    const s = similarity(before.slice(0, k).join(""), after);
    if (s > score) {
      best = k;
      score = s;
    }
  }
  return best;
}

/** The text with only the chosen changes applied (`take[k]` for the k-th
 *  change hunk; unlisted ones are taken). */
export function composeSentences(
  hunks: SentenceHunk[],
  take: boolean[],
): string {
  let k = 0;
  return hunks
    .map((h) => {
      if (h.kind === "same") return h.text;
      const use = take[k++] ?? true;
      return use ? h.after : h.before;
    })
    .join("");
}
