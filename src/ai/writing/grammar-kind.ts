import { CJK_SCRIPT } from "../../utils/cjk";

/**
 * What kind of slip a grammar suggestion fixes, for the label on its card:
 * a writing-rules finding, punctuation only, a misspelling or wrong
 * character, or grammar. Read off the change itself - the checker reports
 * a description, not a category - so it is a guess with a safe default:
 * anything not plainly one of the first three is "grammar".
 */
export type GrammarKind = "rules" | "punctuation" | "spelling" | "grammar";

const PUNCT = /[\p{P}\p{S}\s]/gu;

export function grammarKind(
  original: string | undefined,
  suggestion: string,
  rule?: string,
): GrammarKind {
  if (rule) return "rules";
  const before = original ?? "";
  if (before && before.replace(PUNCT, "") === suggestion.replace(PUNCT, ""))
    return "punctuation";
  const a = [...before.trim()];
  const b = [...suggestion.trim()];
  if (a.length === 0 || b.length === 0) return "grammar";
  if (CJK_SCRIPT.test(before)) {
    // A wrong character: as long as before, one or two characters swapped.
    if (a.length !== b.length || a.length > 6) return "grammar";
    const swaps = a.flatMap((ch, i) => (ch !== b[i] ? [ch + b[i]] : []));
    // 的/地/得 and the like are particles - grammar, however small.
    if (swaps.some((pair) => /^[的地得在再做作]{2}$/u.test(pair)))
      return "grammar";
    return swaps.length <= 2 ? "spelling" : "grammar";
  }
  // One word for one word, a letter or two apart.
  if (/\s/.test(before.trim()) || /\s/.test(suggestion.trim()))
    return "grammar";
  return distance(a, b) <= Math.max(1, Math.min(2, Math.floor(a.length / 3)))
    ? "spelling"
    : "grammar";
}

/** Levenshtein distance over code points. */
function distance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] +
          (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length];
}
