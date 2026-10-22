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
  // rewrite was shown whole. A picture's `![` is no exclamation. The break
  // after a sentence goes with it.
  const parts =
    text.match(
      /(?:[^。！？!?.;；\n]|\.(?!\s|$|\\\n|<br\s*\/?>)|!(?=\[))*(?:[。！？!?;；]+|\.|\n+|$)[”’"')）」』\]]*(?:\\\n|<br\s*\/?>|\s)*/g,
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

/** A sentence as it is drawn in its place in the text: trimBreaks, and
 *  without a heading's `#`s - the heading it stands in already is one, and
 *  inline its marker showed as text ("# The moon can hear"). */
export function inlineSentence(sentence: string): string {
  return trimBreaks(sentence).replace(/^#{1,6}[ \t]+/, "");
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
  // A rewrite still streaming in regroups only the paragraphs it has
  // finished: a paragraph's shape can't be judged half written.
  return regroup(sentencePairs(a, b, alignTail), alignTail === alignRun).map(
    (p) =>
      p.same
        ? { kind: "same" as const, text: p.after }
        : { kind: "change" as const, before: p.before, after: p.after },
  );
}

/** The sentences of `a` and `b` paired: the same ones (LCS), and each run
 *  of changed ones aligned by what they say. */
function sentencePairs(
  a: string[],
  b: string[],
  alignTail: typeof alignRun = alignRun,
): Pair[] {
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] =
        a[i].trim() === b[j].trim()
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const pairs: Pair[] = [];
  let pendingBefore: string[] = [];
  let pendingAfter: string[] = [];
  // A run of changed sentences is aligned sentence to sentence by what
  // they say (alignRun), so each becomes its own decision - also when the
  // rewrite split one sentence in two or joined two into one.
  const flush = (align = alignRun) => {
    for (const group of align(pendingBefore, pendingAfter))
      pairs.push({ same: false, ...group });
    pendingBefore = [];
    pendingAfter = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].trim() === b[j].trim()) {
      flush();
      pairs.push({ same: true, before: a[i], after: b[j] });
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
  return pairs;
}

/** A hunk with both sides kept: a "same" sentence may differ in the
 *  paragraph break it carries (two paragraphs joined into one). */
interface Pair {
  same: boolean;
  before: string;
  after: string;
}

/** A paragraph more of whose sentences than this changed, and which
 *  reads less like its original than REWRITTEN (`similarity`), was
 *  rewritten: it is one change, struck whole with the new paragraph after
 *  it - by sentence it read as red and green confetti. A polish that
 *  touched a few words in every sentence stays sentence by sentence. */
const DENSE = 0.5;
const REWRITTEN = 0.55;

const ENDS_PARAGRAPH = /\n[ \t]*\n\s*$/;

/**
 * How finely a rewrite is decided, chosen by what it did. Its pairs are cut
 * into the smallest runs both sides of which end a paragraph together;
 * then each run:
 *
 * - kept its paragraphs (as many new as old): paragraph by paragraph, each
 *   one sentence by sentence - or whole when most of it changed (DENSE);
 * - joined, split or regrouped paragraphs: one change, its paragraphs from
 *   the original against the new ones they became (the joined paragraphs
 *   struck in place: pending-edit-plugin's struck blocks).
 *
 * `finished` false: the last run, which may still grow, stays as it is.
 */
function regroup(pairs: Pair[], finished: boolean): Pair[] {
  const out: Pair[] = [];
  let run: Pair[] = [];
  // Runs next to each other that both joined or split paragraphs are
  // shaped as one: sentences paired across a paragraph break (a line of
  // dialogue dropped into the narration before it) cut a join of three
  // lines in two, and alignParagraphs struck one of them on its own.
  let uneven: Pair[] = [];
  const flush = () => {
    if (uneven.length > 0) out.push(...shapeRun(uneven));
    uneven = [];
  };
  const close = () => {
    if (run.length === 0) return;
    const before = run.map((p) => p.before).join("");
    const after = run.map((p) => p.after).join("");
    if (paragraphCount(before) !== paragraphCount(after)) uneven.push(...run);
    else {
      flush();
      out.push(...shapeRun(run));
    }
    run = [];
  };
  for (let k = 0; k < pairs.length; k++) {
    run.push(pairs[k]);
    const last = k === pairs.length - 1;
    const before = run.map((p) => p.before).join("");
    const after = run.map((p) => p.after).join("");
    const ends = (text: string) => !text || ENDS_PARAGRAPH.test(text);
    if (last ? finished : ends(before) && ends(after)) close();
  }
  // Still streaming, a join just before the text being written may go on
  // into it: shaped already unless that leaves a paragraph struck on its
  // own at its end (the rest of the join not written yet), so its card
  // stands where it will once the stream ends.
  if (finished || run.length === 0) flush();
  else {
    const shaped = shapeRun(uneven);
    const tail = shaped[shaped.length - 1];
    const alone =
      tail !== undefined && (tail.before === "") !== (tail.after === "");
    out.push(...(alone ? uneven : shaped));
  }
  out.push(...run);
  return out;
}

/** How many paragraphs with text `text` holds. */
function paragraphCount(text: string): number {
  return paragraphsOf(text).filter((t) => t.trim()).length;
}

/** One run of `regroup`, shaped. */
function shapeRun(run: Pair[]): Pair[] {
  const before = run.map((p) => p.before).join("");
  const after = run.map((p) => p.after).join("");
  const count = paragraphCount;
  // Joined paragraphs are a change even with every sentence as it was:
  // taken as "same", accepting joined them unseen. Each new paragraph is set
  // against the ones it came from (alignParagraphs) - a translation, which
  // nothing pairs sentence by sentence, used to be one change for all of it.
  if (count(before) !== count(after)) {
    if (count(before) === 0 || count(after) === 0)
      return [{ same: false, before, after }];
    return alignParagraphs(paragraphsOf(before), paragraphsOf(after)).flatMap(
      (g) =>
        g.olds.length === 1 && g.news.length === 1
          ? dense(
              sentencePairs(
                splitSentences(g.olds[0]),
                splitSentences(g.news[0]),
              ),
            )
          : [{ same: false, before: g.olds.join(""), after: g.news.join("") }],
    );
  }
  if (run.every((p) => p.same)) return run;
  if (count(before) > 1) {
    // As many paragraphs, broken differently than sentence by sentence
    // (the run didn't end at each): paired paragraph by paragraph, each
    // compared again by its sentences.
    const olds = paragraphsOf(before);
    const news = paragraphsOf(after);
    if (olds.length === news.length)
      return olds.flatMap((text, i) =>
        dense(sentencePairs(splitSentences(text), splitSentences(news[i]))),
      );
    return [{ same: false, before, after }];
  }
  return dense(run);
}

/** What a paragraph is, by how its Markdown starts (or, for speech, by
 *  its quotes): a heading pairs with a heading, a picture with a picture,
 *  a line of dialogue with one. */
function paragraphKind(text: string): string {
  const t = text.trimStart();
  if (/^#{1,6}\s/.test(t)) return "heading";
  if (/^(!\[|<img\b)/.test(t)) return "picture";
  if (/^([-*+]|\d+[.)])\s/.test(t)) return "list";
  if (t.startsWith(">")) return "quote";
  if (/^(```|~~~|\$\$)/.test(t)) return "code";
  if (t.startsWith("|")) return "table";
  // Speech, in any script's quotes: a line of dialogue pairs with one.
  if (/[“”"「」『』«»]/.test(t)) return "speech";
  return "text";
}

/** A paragraph left out or added on its own costs this much. */
const LONE_PARAGRAPH = 1.5;

/** The most paragraphs one paragraph is joined from or split into. */
const MAX_GROUP = 4;

/**
 * Pairs the paragraphs of a rewrite that has a different number of them:
 * each original with the one it became, or two joined into one, one split
 * in two, one dropped or added - the cheapest alignment in order, by how
 * long each is against the whole (so a translation, whose words share
 * nothing with its original, still pairs paragraph by paragraph), by kind,
 * and by what they share where they are in the same language.
 */
function alignParagraphs(
  olds: string[],
  news: string[],
): { olds: string[]; news: string[] }[] {
  const size = (parts: string[]) =>
    Math.max(
      1,
      parts.reduce((n, t) => n + t.trim().length, 0),
    );
  const ratio = size(news) / size(olds);
  const cost = (a: string[], b: string[]) => {
    if (a.length === 0 || b.length === 0) return LONE_PARAGRAPH;
    let c = Math.abs(Math.log(size(b) / (ratio * size(a))));
    // Every paragraph of a group of the kind it becomes: a line of
    // dialogue isn't joined to the narration before it.
    const kind = paragraphKind(b[0]);
    for (const t of a) if (paragraphKind(t) !== kind) c += 2;
    c -= similarity(a.join(""), b.join(""));
    // A join or a split must earn its place over a pair.
    if (a.length + b.length > 2) c += 0.3;
    return c;
  };
  const m = olds.length;
  const n = news.length;
  const best: { cost: number; di: number; dj: number }[][] = Array.from(
    { length: m + 1 },
    () => new Array(n + 1).fill({ cost: Infinity, di: 0, dj: 0 }),
  );
  best[0][0] = { cost: 0, di: 0, dj: 0 };
  // A pair, a join or a split of up to MAX_GROUP paragraphs (three lines
  // of dialogue said as one), a paragraph dropped or added.
  const moves: [number, number][] = [
    [1, 1],
    [1, 0],
    [0, 1],
  ];
  for (let k = 2; k <= MAX_GROUP; k++) moves.push([k, 1], [1, k]);
  for (let i = 0; i <= m; i++)
    for (let j = 0; j <= n; j++) {
      const here = best[i][j].cost;
      if (here === Infinity) continue;
      for (const [di, dj] of moves) {
        const ni = i + di;
        const nj = j + dj;
        if (ni > m || nj > n) continue;
        const c = here + cost(olds.slice(i, ni), news.slice(j, nj));
        if (c < best[ni][nj].cost) best[ni][nj] = { cost: c, di, dj };
      }
    }
  const groups: { olds: string[]; news: string[] }[] = [];
  for (let i = m, j = n; i > 0 || j > 0;) {
    const { di, dj } = best[i][j];
    groups.unshift({
      olds: olds.slice(i - di, i),
      news: news.slice(j - dj, j),
    });
    i -= di;
    j -= dj;
  }
  return groups;
}

/** One paragraph's pairs, whole when it was rewritten (DENSE). */
function dense(run: Pair[]): Pair[] {
  const sentences = run.reduce(
    (n, p) => n + splitSentences(p.before).filter((s) => s.trim()).length,
    0,
  );
  const changed = run
    .filter((p) => !p.same)
    .reduce(
      (n, p) => n + splitSentences(p.before).filter((s) => s.trim()).length,
      0,
    );
  if (sentences < 2 || changed / sentences <= DENSE) return run;
  const before = run.map((p) => p.before).join("");
  const after = run.map((p) => p.after).join("");
  if (similarity(before, after) >= REWRITTEN) return run;
  return [{ same: false, before, after }];
}

/** A paragraph's end inside a text: the break a sentence carries. */
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
