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

/** A line's leading marks: a quote's `>`s, then a heading's `#`s or a list
 *  item's marker. */
const LINE_MARKS =
  /^(?:>[ \t]?)*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)?/;

const QUOTE_MARKS = /^(?:>[ \t]?)*/;

/** A line's marks after its quote's: a heading's, a bullet or a number. */
function markKind(marks: string): string {
  const rest = marks.slice(QUOTE_MARKS.exec(marks)![0].length);
  return rest[0] === "#" ? "#" : /^[-*+]/.test(rest) ? "-" : rest && "1";
}

/** Whether `line` is a list item's, in a quote or not. */
export function isListItem(line: string): boolean {
  const kind = markKind(LINE_MARKS.exec(line.trim())![0]);
  return kind === "-" || kind === "1";
}

/** A change's new text as drawn in the line of its original: one line
 *  rewriting a list item or a quote's line is drawn in that line without
 *  its marks, which would show as text there. A quote's `>`s go when as
 *  deep as the original's, a list's marker only when of the same kind
 *  ("- " and "* ", "1. " and "2023. "): "- 甲" rewritten "2023. 年份变了"
 *  keeps its year. */
export function inlineChange(before: string, after: string): string {
  const text = inlineSentence(after);
  const was = LINE_MARKS.exec(before.trim())![0];
  if (text.includes("\n") || !was) return text;
  const marks = LINE_MARKS.exec(text)![0];
  const quote = QUOTE_MARKS.exec(marks)![0];
  const depth = (m: string) => (m.match(/>/g) ?? []).length;
  if (depth(quote) !== depth(QUOTE_MARKS.exec(was)![0])) return text;
  const own = marks.length > quote.length && markKind(marks) === markKind(was);
  return text.slice(own ? marks.length : quote.length);
}

/** Several lines or blocks as one line, for a row that shows only its
 *  start: the lines joined, without their list, quote or heading marks. */
export function oneLine(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) =>
      trimBreaks(line).replace(
        /^(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/,
        "",
      ),
    )
    .filter(Boolean)
    .join(" ");
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
