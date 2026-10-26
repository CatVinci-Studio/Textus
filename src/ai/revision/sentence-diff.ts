/** Sentence-level diff for partially accepting a rewrite. Sentences, not
 *  words, as word-level picks make broken grammar; the pieces join back into
 *  the text exactly. */

import { formKey } from "./markdown-forms";
import { MATCH, similarity } from "./sentence-similarity";

export type SentenceHunk =
  | { kind: "same"; text: string }
  | { kind: "change"; before: string; after: string };

export function splitSentences(text: string): string[] {
  // A full stop ends a sentence only before a space, a line break or the
  // end, not in 3.14 or a URL. A picture's `![` is no exclamation.
  const parts =
    text.match(
      /(?:[^。！？!?.;；؟।…\n]|\.(?!\s|$|\\\n|<br\s*\/?>)|!(?=\[))*(?:[。！？!?;；؟।…]+|\.|\n+|$)[”’"')）」』\]]*(?:\\\n|<br\s*\/?>|\s)*/g,
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

/** The sentences of `a` and `b` paired: the same ones (LCS), and each run
 *  of changed ones aligned by what they say. */
function sentencePairs(
  a: string[],
  b: string[],
  alignTail: (
    before: string[],
    after: string[],
  ) => { before: string; after: string }[] = alignRun,
): Pair[] {
  // `<https://…>` from the editor and `https://…` from a model are the same.
  const keyA = a.map(formKey);
  const keyB = b.map(formKey);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] =
        keyA[i] === keyB[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const pairs: Pair[] = [];
  let pendingBefore: string[] = [];
  let pendingAfter: string[] = [];
  // A run of changed sentences is aligned by what they say, so each is its
  // own decision, splits and joins too.
  const flush = (align = alignRun) => {
    for (const group of align(pendingBefore, pendingAfter))
      pairs.push({ same: false, ...group });
    pendingBefore = [];
    pendingAfter = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && keyA[i] === keyB[j]) {
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

/** A paragraph with more of its sentences changed than this, reading less
 *  like its original than REWRITTEN, is one change, not sentence confetti. */
const DENSE = 0.5;
const REWRITTEN = 0.55;

/** A paragraph this short, changed whole next to another such, is decided
 *  with it, not a card a line. */
const SHORT_PARAGRAPH = 80;
/** Short paragraphs taken together up to this much, then a new change. */
const MERGED_AT_MOST = 320;
/** Plain text: not a heading, a list item, a quote, a table, a fence, a
 *  formula, a footnote, a picture or HTML - those keep their own card. */
const PLAIN =
  /^(?!\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|\$\$|!\[|\[\^|<|\[toc\]))/i;

/** Adjacent changes that are each a whole short paragraph on both sides,
 *  merged into one change. */
function mergeShortParagraphs(pairs: Pair[]): Pair[] {
  const out: Pair[] = [];
  // Whether the text so far ends a paragraph: a change after that which
  // ends one too is a whole paragraph. The text's own end ends one.
  let atParagraph = true;
  let run: Pair | null = null;
  pairs.forEach((p, i) => {
    const last = i === pairs.length - 1;
    const ends =
      last || (ENDS_PARAGRAPH.test(p.before) && ENDS_PARAGRAPH.test(p.after));
    const whole =
      !p.same &&
      atParagraph &&
      ends &&
      PLAIN.test(p.before) &&
      PLAIN.test(p.after) &&
      paragraphCount(p.before) === 1 &&
      paragraphCount(p.after) === 1 &&
      p.before.trim().length <= SHORT_PARAGRAPH &&
      p.after.trim().length <= SHORT_PARAGRAPH;
    if (
      whole &&
      run &&
      run.before.length + p.before.length <= MERGED_AT_MOST &&
      run.after.length + p.after.length <= MERGED_AT_MOST
    ) {
      run.before += p.before;
      run.after += p.after;
    } else {
      run = whole ? { ...p } : null;
      out.push(run ?? p);
    }
    atParagraph = ends;
  });
  return out;
}

/** A paragraph's end, carried by its last sentence. */
export const ENDS_PARAGRAPH = /\n[ \t]*\n\s*$/;

/** A paragraph's end inside a text. */
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

/** How finely a rewrite is decided: runs that kept their paragraphs go
 *  sentence by sentence (or whole when DENSE); joins and splits are one
 *  change. Unfinished, the last run stays unless it is whole paragraphs. */
function regroup(pairs: Pair[], finished: boolean): Pair[] {
  const out: Pair[] = [];
  let run: Pair[] = [];
  // Adjacent runs that joined or split paragraphs are shaped as one, or a
  // pairing across a paragraph break would cut a join in two.
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
    // The last run, still streaming, is whole paragraphs once both sides
    // end one, and is shaped then.
    const whole = ends(before) && ends(after);
    if (last ? finished || (whole && !!before && !!after) : whole) close();
  }
  // Still streaming, a join may go on into the text being written: shaped
  // already unless that leaves a paragraph struck on its own at its end.
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
export function paragraphCount(text: string): number {
  return paragraphsOf(text).filter((t) => t.trim()).length;
}

/** One run of `regroup`, shaped. */
function shapeRun(run: Pair[]): Pair[] {
  const before = run.map((p) => p.before).join("");
  const after = run.map((p) => p.after).join("");
  const count = paragraphCount;
  // Joined paragraphs are a change even with every sentence as it was, or
  // accepting would join them unseen. Each new one is set against its sources.
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
    // As many paragraphs, broken differently: paired paragraph by paragraph,
    // each compared again by its sentences.
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

/** Pairs the paragraphs of a rewrite with a different number of them, by
 *  relative length (so translations pair too), kind, and shared words. */
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

/** Pairs a changed run's sentences 1:1, 1:2 or 2:1 by the most similar
 *  alignment in order. With nothing similar enough, it stays one change. */
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
  // `band`: only alignments this near the diagonal, for a streaming rewrite
  // that runs this once per completed sentence.
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
  // Nothing paired up: one change.
  if (!groups.some((g) => g.before && g.after))
    return [{ before: before.join(""), after: after.join("") }];
  // A lone dropped or added sentence joins its neighbouring pair, rather
  // than standing alone between two pairs.
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
