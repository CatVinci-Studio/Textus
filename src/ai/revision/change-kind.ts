import { CJK_SCRIPT } from "../../utils/cjk";

/**
 * What kind of change a revision makes, read off its before and after
 * alone - no model, no request: the evidence revision-learning.ts counts
 * when it notices the writer turning the same kind down again and again.
 *
 * Only kinds narrow enough to become one requirement are named: a quote
 * style or mark traded for another, full- and half-width punctuation, the
 * Oxford comma, contractions, a word swapped for another, sentences split
 * or joined, and a passage made much shorter or longer. A change that is
 * none of these (most rewrites) has no kind and is not recorded.
 */

export type ChangeKind =
  /** One word, mark or quote style traded for another, e.g. 「」 -> “”. */
  | { type: "swap"; from: string; to: string }
  /** Full-width punctuation made half-width ("half") or the reverse. */
  | { type: "width"; to: "half" | "full" }
  | { type: "oxford"; add: boolean }
  | { type: "contractions"; expand: boolean }
  | { type: "sentences"; split: boolean }
  | { type: "length"; shorter: boolean };

/** A kind as one string, what the log stores: its type and parameters
 *  joined by tabs, which a swap's word or mark never contains. */
export function kindKey(kind: ChangeKind): string {
  switch (kind.type) {
    case "swap":
      return `swap\t${kind.from}\t${kind.to}`;
    case "width":
      return `width\t${kind.to}`;
    case "oxford":
      return `oxford\t${kind.add ? "add" : "remove"}`;
    case "contractions":
      return `contractions\t${kind.expand ? "expand" : "add"}`;
    case "sentences":
      return `sentences\t${kind.split ? "split" : "merge"}`;
    case "length":
      return `length\t${kind.shorter ? "shorter" : "longer"}`;
  }
}

export function parseKindKey(key: string): ChangeKind | null {
  const [type, a, b] = key.split("\t");
  switch (type) {
    case "swap":
      return a && b ? { type, from: a, to: b } : null;
    case "width":
      return a === "half" || a === "full" ? { type, to: a } : null;
    case "oxford":
      return a === "add" || a === "remove" ? { type, add: a === "add" } : null;
    case "contractions":
      return a === "expand" || a === "add"
        ? { type, expand: a === "expand" }
        : null;
    case "sentences":
      return a === "split" || a === "merge"
        ? { type, split: a === "split" }
        : null;
    case "length":
      return a === "shorter" || a === "longer"
        ? { type, shorter: a === "shorter" }
        : null;
  }
  return null;
}

/** Quote marks by the style they belong to, named by its pair. */
const QUOTE_STYLE: Record<string, string> = {
  "「": "「」",
  "」": "「」",
  "『": "『』",
  "』": "『』",
  "“": "“”",
  "”": "“”",
  "‘": "‘’",
  "’": "‘’",
  '"': '""',
  "'": "''",
  "«": "«»",
  "»": "«»",
};

/** Full-width punctuation and its half-width form. */
const HALF_OF: Record<string, string> = {
  "，": ",",
  "。": ".",
  "：": ":",
  "；": ";",
  "！": "!",
  "？": "?",
  "（": "(",
  "）": ")",
};
const FULL_OF = Object.fromEntries(
  Object.entries(HALF_OF).map(([full, half]) => [half, full]),
);

const CONTRACTIONS: Record<string, string> = {
  "don't": "do not",
  "doesn't": "does not",
  "didn't": "did not",
  "can't": "cannot",
  "won't": "will not",
  "isn't": "is not",
  "aren't": "are not",
  "wasn't": "was not",
  "weren't": "were not",
  "haven't": "have not",
  "hasn't": "has not",
  "hadn't": "had not",
  "wouldn't": "would not",
  "couldn't": "could not",
  "shouldn't": "should not",
  "it's": "it is",
  "that's": "that is",
  "there's": "there is",
  "what's": "what is",
  "let's": "let us",
  "i'm": "i am",
  "you're": "you are",
  "we're": "we are",
  "they're": "they are",
  "i've": "i have",
  "you've": "you have",
  "we've": "we have",
  "they've": "they have",
  "i'll": "i will",
  "you'll": "you will",
  "we'll": "we will",
  "they'll": "they will",
  "i'd": "i would",
  "you'd": "you would",
};
const CONTRACTION =
  /\b(?:don|doesn|didn|can|won|isn|aren|wasn|weren|haven|hasn|hadn|wouldn|couldn|shouldn|it|that|there|what|let|i|you|we|they)'(?:t|s|m|re|ve|ll|d)\b/g;

const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);
const isCjkScript = (c: string) => CJK_SCRIPT.test(c);
/** The letters and digits, which a punctuation-only change leaves alone. */
const wordsOf = (text: string) => [...text].filter(isWordChar).join("");
/** The marks, in order: what is neither a letter, a digit nor a space. */
const marksOf = (text: string) =>
  [...text].filter((c) => !isWordChar(c) && !/\s/.test(c));

/** The kinds of one change. `before` and `after` are a changed sentence
 *  (or a passage) and what the revision would write instead. */
export function classifyChange(before: string, after: string): ChangeKind[] {
  const a = before.trim();
  const b = after.trim();
  if (!a || !b || a === b) return [];
  if (wordsOf(a) === wordsOf(b)) return punctuationKinds(a, b);
  const contractions = contractionKind(a, b);
  if (contractions) return [contractions];
  const swap = wordSwap(a, b);
  if (swap) return [swap];
  return [...sentenceKinds(a, b), ...lengthKinds(a, b)];
}

function punctuationKinds(a: string, b: string): ChangeKind[] {
  const oxford = oxfordKind(a, b);
  if (oxford) return [oxford];
  const ma = marksOf(a);
  const mb = marksOf(b);
  if (ma.length !== mb.length) return [];
  const quotes = new Set<string>();
  const widths = new Set<"half" | "full">();
  const others = new Set<string>();
  for (let i = 0; i < ma.length; i++) {
    const [x, y] = [ma[i], mb[i]];
    if (x === y) continue;
    if (QUOTE_STYLE[x] && QUOTE_STYLE[y])
      quotes.add(`${QUOTE_STYLE[x]}\t${QUOTE_STYLE[y]}`);
    else if (HALF_OF[x] === y) widths.add("half");
    else if (FULL_OF[x] === y) widths.add("full");
    else others.add(`${x}\t${y}`);
  }
  const kinds: ChangeKind[] = [];
  // One style for another; quotes mixed every which way say nothing.
  if (quotes.size === 1) {
    const [from, to] = [...quotes][0].split("\t");
    if (from !== to) kinds.push({ type: "swap", from, to });
  }
  if (widths.size === 1) kinds.push({ type: "width", to: [...widths][0] });
  if (others.size === 1) {
    const [from, to] = [...others][0].split("\t");
    kinds.push({ type: "swap", from, to });
  }
  return kinds;
}

/** `text` without its serial commas: a comma before "and"/"or" that ends a
 *  list, i.e. with another comma earlier in the same clause. */
function withoutSerialCommas(text: string): string {
  return text.replace(/,(\s+(?:and|or)\s)/gi, (whole, rest, at: number) => {
    const clause =
      text
        .slice(0, at)
        .split(/[.;:!?\n]/)
        .pop() ?? "";
    return clause.includes(",") ? rest : whole;
  });
}

function oxfordKind(a: string, b: string): ChangeKind | null {
  if (withoutSerialCommas(b) === a && b !== a)
    return { type: "oxford", add: true };
  if (withoutSerialCommas(a) === b && a !== b)
    return { type: "oxford", add: false };
  return null;
}

function expandContractions(text: string): string {
  return text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(CONTRACTION, (c) => CONTRACTIONS[c] ?? c);
}

const contractionCount = (text: string) =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .match(CONTRACTION)
    ?.filter((c) => c in CONTRACTIONS).length ?? 0;

function contractionKind(a: string, b: string): ChangeKind | null {
  if (expandContractions(a) !== expandContractions(b)) return null;
  const [ca, cb] = [contractionCount(a), contractionCount(b)];
  if (ca === cb) return null;
  return { type: "contractions", expand: cb < ca };
}

/** One word (or a few CJK characters) traded for another, the rest of the
 *  change word for word the same. */
function wordSwap(a: string, b: string): ChangeKind | null {
  const ca = [...a];
  const cb = [...b];
  let start = 0;
  while (start < ca.length && start < cb.length && ca[start] === cb[start])
    start++;
  let end = 0;
  while (
    end < ca.length - start &&
    end < cb.length - start &&
    ca[ca.length - 1 - end] === cb[cb.length - 1 - end]
  )
    end++;
  // Out to whole words: "use" against "utilize" shares a "u".
  const wordAt = (chars: string[], i: number) =>
    i >= 0 &&
    i < chars.length &&
    isWordChar(chars[i]) &&
    !isCjkScript(chars[i]);
  while (start > 0 && (wordAt(ca, start - 1) || wordAt(cb, start - 1))) start--;
  while (
    end > 0 &&
    (wordAt(ca, ca.length - end) || wordAt(cb, cb.length - end))
  )
    end--;
  const from = ca
    .slice(start, ca.length - end)
    .join("")
    .trim();
  const to = cb
    .slice(start, cb.length - end)
    .join("")
    .trim();
  const plain = (s: string) =>
    s.length > 0 && wordsOf(s).length > 0 && !/[\t\n。！？!?.;；]/.test(s);
  if (!plain(from) || !plain(to)) return null;
  const short = (s: string) =>
    [...s].some(isCjkScript)
      ? [...s].length <= 4
      : s.split(/\s+/).length <= 2 && s.length <= 24;
  if (!short(from) || !short(to)) return null;
  const latin = ![...from, ...to].some(isCjkScript);
  return {
    type: "swap",
    from: latin ? from.toLowerCase() : from,
    to: latin ? to.toLowerCase() : to,
  };
}

/** Sentences, counted by their ends (。！？.!? and line breaks). */
function sentenceCount(text: string): number {
  return text
    .split(/(?<=[。！？!?])|(?<=\.)(?=\s)|\n+/)
    .filter((s) => wordsOf(s).length > 0).length;
}

function sentenceKinds(a: string, b: string): ChangeKind[] {
  const [na, nb] = [sentenceCount(a), sentenceCount(b)];
  const ratio = wordsOf(b).length / Math.max(1, wordsOf(a).length);
  // About the same words, in more or fewer sentences.
  if (na === nb || ratio < 0.75 || ratio > 1.33) return [];
  return [{ type: "sentences", split: nb > na }];
}

function lengthKinds(a: string, b: string): ChangeKind[] {
  const [la, lb] = [wordsOf(a).length, wordsOf(b).length];
  if (la < 20) return [];
  if (lb <= la * 0.7) return [{ type: "length", shorter: true }];
  if (lb >= la * 1.4) return [{ type: "length", shorter: false }];
  return [];
}
