/**
 * Sentence-level diff for partially accepting a rewrite: the proposal card
 * lists each changed sentence (group) with a checkbox, and the accepted
 * text is the original with only the checked changes applied.
 *
 * Sentences, not words: a word-level pick produces Frankenstein grammar,
 * while a writer judging a rewrite thinks "keep this sentence, not that
 * one". Ends at CJK and Latin terminators and line breaks; a terminator
 * keeps its trailing quote/bracket and whitespace with it, so joining the
 * pieces reproduces the text exactly.
 */

export type SentenceHunk =
  | { kind: "same"; text: string }
  | { kind: "change"; before: string; after: string };

export function splitSentences(text: string): string[] {
  // A full stop ends a sentence before a space, a line break (a Markdown
  // hard break, `\` or `<br>`, too) or the end; elsewhere (3.14, a URL) it
  // is part of the sentence - which used to fail the whole split, and the
  // rewrite was shown whole. The break after a sentence goes with it.
  const parts =
    text.match(
      /(?:[^。！？!?.;；\n]|\.(?!\s|$|\\\n|<br\s*\/?>))*(?:[。！？!?;；]+|\.|\n+|$)[”’"')）」』\]]*(?:\\\n|<br\s*\/?>|\s)*/g,
    ) ?? [];
  const out = parts.filter((p) => p.length > 0);
  // Anything the pattern skipped (shouldn't happen) is kept rather than lost.
  return out.join("") === text ? out : [text];
}

/** A sentence as it is shown on its own: without the whitespace and the
 *  line break (`\` or `<br>`) it carries at its end, which stays the
 *  document's - parsed alone, a trailing `\` is a literal backslash. */
export function trimBreaks(sentence: string): string {
  return sentence
    .trim()
    .replace(/(?:\\|<br\s*\/?>)+$/, "")
    .trim();
}

/** LCS over sentences, then runs of non-matching sentences become change
 *  hunks (see flush). */
export function diffSentences(before: string, after: string): SentenceHunk[] {
  return diffSentenceLists(splitSentences(before), splitSentences(after));
}

/**
 * `diffSentences` over sentences already split. `alignTail` aligns the last
 * run of changed sentences - the one that reaches the end of `a` - and
 * defaults to `alignRun`; a rewrite still streaming in (sentence-stream.ts)
 * passes its own, which leaves out the originals the new text hasn't
 * reached yet instead of calling them deleted.
 */
export function diffSentenceLists(
  a: string[],
  b: string[],
  alignTail: typeof alignRun = alignRun,
): SentenceHunk[] {
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] =
        a[i].trim() === b[j].trim()
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const hunks: SentenceHunk[] = [];
  let pendingBefore: string[] = [];
  let pendingAfter: string[] = [];
  // A run of changed sentences is aligned sentence to sentence by what
  // they say (alignRun), so each becomes its own decision - also when the
  // rewrite split one sentence in two or joined two into one.
  const flush = (align = alignRun) => {
    for (const group of align(pendingBefore, pendingAfter))
      hunks.push({ kind: "change", ...group });
    pendingBefore = [];
    pendingAfter = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].trim() === b[j].trim()) {
      flush();
      hunks.push({ kind: "same", text: b[j] });
      i++;
      j++;
    } else if (
      j < b.length &&
      (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])
    ) {
      pendingAfter.push(b[j++]);
    } else {
      pendingBefore.push(a[i++]);
    }
  }
  flush(alignTail);
  return hunks.flatMap(byParagraph);
}

/** A paragraph's end inside a sentence run: the break a sentence carries. */
const PARAGRAPH_END = /\n[ \t]*\n\s*/g;

/** `text` cut after each paragraph's end, the breaks kept with the part
 *  before them - so the parts join back into `text`. */
function paragraphsOf(text: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (const m of text.matchAll(PARAGRAPH_END)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end < text.length) {
      parts.push(text.slice(from, end));
      from = end;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/**
 * A change over several of the original's paragraphs, rewritten paragraph by
 * paragraph - as many new ones as old - one for each of them: a whole-text
 * rewrite whose changed sentences ran together came out as one change from
 * the first paragraph to the last, its card at the top of the margin beside
 * nothing in particular. A rewrite that joins or splits paragraphs stays one
 * change: the joined paragraph is shown struck in place (pending-edit-
 * plugin's struck blocks).
 */
function byParagraph(hunk: SentenceHunk): SentenceHunk[] {
  if (hunk.kind !== "change") return [hunk];
  const before = paragraphsOf(hunk.before);
  const after = paragraphsOf(hunk.after);
  if (before.length < 2 || after.length !== before.length) return [hunk];
  return before.map((text, i) => ({
    kind: "change" as const,
    before: text,
    after: after[i],
  }));
}

/** Character bigrams (single characters for one-character text), for a
 *  similarity that works the same for CJK and for spaced scripts. */
function bigrams(text: string): Map<string, number> {
  const known = bigramCache.get(text);
  if (known) return known;
  const chars = [...text.replace(/\s+/g, " ").trim().toLowerCase()];
  const grams = new Map<string, number>();
  const add = (g: string) => grams.set(g, (grams.get(g) ?? 0) + 1);
  if (chars.length < 2) chars.forEach(add);
  for (let k = 0; k + 1 < chars.length; k++) add(chars[k] + chars[k + 1]);
  // The alignment compares the same sentences (and pairs of them) many
  // times over - and again for every sentence a streaming rewrite adds.
  if (bigramCache.size >= BIGRAM_CACHE) bigramCache.clear();
  bigramCache.set(text, grams);
  return grams;
}

const BIGRAM_CACHE = 4096;
const bigramCache = new Map<string, Map<string, number>>();

/** Dice similarity of two texts' bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  let total = 0;
  let shared = 0;
  for (const n of x.values()) total += n;
  for (const [g, n] of y) {
    total += n;
    shared += Math.min(n, x.get(g) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

/** Below this, two sentences are not the same sentence rewritten. */
export const MATCH = 0.25;

/**
 * Pairs the sentences of a changed run: each original sentence with the
 * one, or two, it became (or two originals joined into one), by the most
 * similar alignment in order - a dynamic program over 1:1, 1:2 and 2:1
 * pairs, plus sentences dropped or added on their own. A rewrite that can't
 * be aligned that way (nothing similar enough) stays one change.
 */
export function alignRun(
  before: string[],
  after: string[],
  band = Infinity,
): { before: string; after: string }[] {
  if (before.length === 0 || after.length === 0)
    return before.length || after.length
      ? [{ before: before.join(""), after: after.join("") }]
      : [];
  const m = before.length;
  const n = after.length;
  type Step = { score: number; di: number; dj: number };
  const best: Step[][] = Array.from({ length: m + 1 }, () =>
    new Array<Step>(n + 1).fill({ score: -Infinity, di: 0, dj: 0 }),
  );
  best[0][0] = { score: 0, di: 0, dj: 0 };
  const moves: [number, number][] = [
    [1, 1],
    [1, 2],
    [2, 1],
    [1, 0],
    [0, 1],
  ];
  // `band`: only alignments that stay this near the diagonal (beyond the
  // runs' difference in length) - for a rewrite streaming in, which runs
  // this once per sentence it completes.
  const reach = band + Math.abs(m - n);
  for (let i = 0; i <= m; i++)
    for (let j = 0; j <= n; j++) {
      const here = best[i][j];
      if (here.score === -Infinity) continue;
      for (const [di, dj] of moves) {
        const ni = i + di;
        const nj = j + dj;
        if (ni > m || nj > n || Math.abs(ni - nj) > reach) continue;
        let gain: number;
        if (di === 0 || dj === 0) gain = 0;
        else {
          const sim = similarity(
            before.slice(i, ni).join(""),
            after.slice(j, nj).join(""),
          );
          if (sim < MATCH) continue;
          // A split or join must earn its place over a plain pair.
          gain = sim - (di + dj > 2 ? 0.05 : 0);
        }
        if (here.score + gain > best[ni][nj].score)
          best[ni][nj] = { score: here.score + gain, di, dj };
      }
    }
  const groups: { before: string; after: string }[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const { di, dj } = best[i][j];
    if (di === 0 && dj === 0) break;
    groups.unshift({
      before: before.slice(i - di, i).join(""),
      after: after.slice(j - dj, j).join(""),
    });
    i -= di;
    j -= dj;
  }
  // Nothing paired up: one change, as before.
  if (!groups.some((g) => g.before && g.after))
    return [{ before: before.join(""), after: after.join("") }];
  // A sentence dropped or added on its own joins the pair before it (or
  // after it, at the start), so it is decided with its neighbour rather
  // than as a lone strike or insert between two pairs.
  const merged: { before: string; after: string }[] = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if ((!g.before || !g.after) && last) {
      last.before += g.before;
      last.after += g.after;
    } else merged.push({ ...g });
  }
  if (merged.length > 1 && (!merged[0].before || !merged[0].after)) {
    const first = merged.shift()!;
    merged[0] = {
      before: first.before + merged[0].before,
      after: first.after + merged[0].after,
    };
  }
  return merged;
}

/**
 * How many of a change's original sentences its new text stands for, from
 * the first: the rest were dropped and joined to it (`alignRun`), and its
 * new text goes after those it replaces, not after the dropped ones - so a
 * rewrite streaming in doesn't move a sentence's new text when the stream
 * passes the one after it and finds it dropped.
 */
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
