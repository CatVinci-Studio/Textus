import { textParagraphs } from "../doc-blocks";
import { formKey, wholeBlockKind } from "./markdown-forms";
import {
  diffSentenceLists,
  ENDS_PARAGRAPH,
  splitSentences,
  type SentenceHunk,
} from "./sentence-diff";

/** A rewrite diffed as the document is built: blocks first, then sentences,
 *  the same for a finished rewrite and a streaming one. */

/** What a rewrite is compared by: its sentences, and each non-prose block as
 *  one unit. Joined, the units are `text` again. */
export function splitUnits(text: string): string[] {
  const blocks = textParagraphs(text);
  if (blocks.length === 0) return text ? [text] : [];
  const units: string[] = [];
  let prose = "";
  const flushProse = () => {
    const sentences: string[] = [];
    for (const sentence of splitSentences(prose))
      if (wholeBlockKind(sentence) && sentences.length > 0)
        sentences[sentences.length - 1] += sentence;
      else sentences.push(sentence);
    // One that opens the run goes with the sentence after it.
    if (sentences.length > 1 && wholeBlockKind(sentences[0]))
      sentences.splice(0, 2, sentences[0] + sentences[1]);
    units.push(...sentences);
    prose = "";
  };
  blocks.forEach((block, k) => {
    // Each block runs to the next one's start, its blank lines with it.
    const from = k === 0 ? 0 : block.from;
    const to = k + 1 < blocks.length ? blocks[k + 1].from : text.length;
    const piece = text.slice(from, to);
    if (wholeBlockKind(block.text)) {
      if (prose) flushProse();
      units.push(piece);
    } else prose += piece;
  });
  if (prose) flushProse();
  return units;
}

/** Aligns the run of changed units that ends what a stream has reached:
 *  `before` are originals from `start` on. */
export type AlignTail = (
  before: string[],
  after: string[],
  start: number,
) => { before: string; after: string }[];

/** The hunks of `a`'s units against `b`'s, whole blocks being where the two
 *  sides meet. `tail`: `b` is a stream so far, and originals not reached yet
 *  aren't called deleted. */
export function diffUnits(
  a: string[],
  b: string[],
  tail?: AlignTail,
): SentenceHunk[] {
  const kinds = (units: string[]) =>
    units.map(wholeBlockKind).filter((k) => k !== null);
  const blocksA = kinds(a);
  const blocksB = kinds(b);
  const lined =
    blocksA.slice(0, tail ? blocksB.length : undefined).join() ===
    blocksB.join();
  if (!lined && !tail) return diffByBlocks(a, b);
  if (blocksA.length === 0 || !lined)
    return diffSentenceLists(
      a,
      b,
      tail && ((x, y) => tail(x, y, a.length - x.length)),
    );
  const hunks: SentenceHunk[] = [];
  let i = 0;
  let j = 0;
  for (;;) {
    // The sentences up to the next whole block on each side, then the two
    // blocks.
    const start = i;
    while (i < a.length && !wholeBlockKind(a[i])) i++;
    const sentencesA = a.slice(start, i);
    const from = j;
    while (j < b.length && !wholeBlockKind(b[j])) j++;
    const sentencesB = b.slice(from, j);
    if (tail && j >= b.length) {
      // Where the stream is: the originals after these are still to come.
      hunks.push(
        ...diffSentenceLists(sentencesA, sentencesB, (x, y) =>
          tail(x, y, i - x.length),
        ),
      );
      return hunks;
    }
    if (sentencesA.length || sentencesB.length)
      hunks.push(...diffSentenceLists(sentencesA, sentencesB));
    if (i >= a.length || j >= b.length) return hunks;
    const [blockA, blockB] = [a[i++], b[j++]];
    hunks.push(
      formKey(blockA) === formKey(blockB)
        ? // Kept as the document writes it: a kept table keeps its padding.
          { kind: "same", text: blockA }
        : { kind: "change", before: blockA, after: blockB },
    );
  }
}

/** The hunks of a finished rewrite of `before` into `after` (diffUnits). */
export function diffSentences(before: string, after: string): SentenceHunk[] {
  return diffUnits(splitUnits(before), splitUnits(after));
}

/** A finished rewrite that added or dropped whole blocks, met at the blocks
 *  it kept; a block only one side has is a change of its own. */
function diffByBlocks(a: string[], b: string[]): SentenceHunk[] {
  const wholeA = wholeIndices(a);
  const wholeB = wholeIndices(b);
  const kept = keptPairs(
    wholeA.map((i) => a[i]),
    wholeB.map((j) => b[j]),
  ).map(([x, y]) => [wholeA[x], wholeB[y]] as const);
  const hunks: SentenceHunk[] = [];
  let i = 0;
  let j = 0;
  for (const [ia, jb] of [...kept, [a.length, b.length] as const]) {
    hunks.push(...diffBetween(a.slice(i, ia), b.slice(j, jb)));
    if (ia < a.length)
      hunks.push(
        formKey(a[ia]) === formKey(b[jb])
          ? { kind: "same", text: a[ia] }
          : { kind: "change", before: a[ia], after: b[jb] },
      );
    i = ia + 1;
    j = jb + 1;
  }
  return hunks;
}

function wholeIndices(units: string[]): number[] {
  return units.flatMap((u, i) => (wholeBlockKind(u) ? [i] : []));
}

/** The blocks of `a` and `b` paired in order, scoring an identical pair
 *  above a same-kind one, so a kept block meets its copy. */
function keptPairs(a: string[], b: string[]): [number, number][] {
  const score = (x: number, y: number) =>
    wholeBlockKind(a[x]) !== wholeBlockKind(b[y])
      ? 0
      : formKey(a[x]) === formKey(b[y])
        ? 2
        : 1;
  const n = a.length;
  const m = b.length;
  const best = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let x = n - 1; x >= 0; x--)
    for (let y = m - 1; y >= 0; y--) {
      const pair = score(x, y);
      best[x][y] = Math.max(
        best[x + 1][y],
        best[x][y + 1],
        pair ? best[x + 1][y + 1] + pair : 0,
      );
    }
  const pairs: [number, number][] = [];
  for (let x = 0, y = 0; x < n && y < m;) {
    const pair = score(x, y);
    if (pair && best[x][y] === best[x + 1][y + 1] + pair)
      pairs.push([x++, y++]);
    else if (best[x + 1][y] >= best[x][y + 1]) x++;
    else y++;
  }
  return pairs;
}

/** Units between two kept blocks, with blocks only one side has. Both sides
 *  are cut at every block of either, so no change runs across a block. */
function diffBetween(a: string[], b: string[]): SentenceHunk[] {
  const sideA = paragraphsAndBlocks(a);
  const sideB = paragraphsAndBlocks(b);
  // Every block of either side, by how far through its side's paragraphs
  // it stands (0 to 1); the original's first where both stand alike.
  const cuts = [
    ...sideA.blocks.map((blk) => ({ ...blk, side: "a" as const })),
    ...sideB.blocks.map((blk) => ({ ...blk, side: "b" as const })),
  ]
    .map((cut) => ({
      ...cut,
      at: through(cut.before, (cut.side === "a" ? sideA : sideB).paragraphs),
    }))
    .sort(
      (x, y) =>
        x.at - y.at || (x.side === y.side ? 0 : x.side === "a" ? -1 : 1),
    );
  const hunks: SentenceHunk[] = [];
  let pa = 0;
  let pb = 0;
  const diffUpTo = (toA: number, toB: number) => {
    const before = sideA.paragraphs.slice(pa, toA).flat();
    const after = sideB.paragraphs.slice(pb, toB).flat();
    if (before.length || after.length)
      hunks.push(...diffSentenceLists(before, after));
    pa = Math.max(pa, toA);
    pb = Math.max(pb, toB);
  };
  for (const cut of cuts) {
    const own = cut.side === "a" ? cut.before : pa;
    const other = cut.side === "b" ? cut.before : pb;
    const toA =
      cut.side === "a" ? own : at(cut.at, sideA.paragraphs.length, pa);
    const toB =
      cut.side === "b" ? other : at(cut.at, sideB.paragraphs.length, pb);
    diffUpTo(Math.max(pa, toA), Math.max(pb, toB));
    hunks.push(
      cut.side === "a"
        ? { kind: "change", before: cut.text, after: "" }
        : { kind: "change", before: "", after: cut.text },
    );
  }
  diffUpTo(sideA.paragraphs.length, sideB.paragraphs.length);
  return hunks;
}

/** `units` as its paragraphs (each its sentences), and its whole blocks
 *  with how many paragraphs stand before each. */
function paragraphsAndBlocks(units: string[]): {
  paragraphs: string[][];
  blocks: { text: string; before: number }[];
} {
  const paragraphs: string[][] = [];
  const blocks: { text: string; before: number }[] = [];
  let open: string[] = [];
  const close = () => {
    if (open.length) paragraphs.push(open);
    open = [];
  };
  for (const unit of units)
    if (wholeBlockKind(unit)) {
      close();
      blocks.push({ text: unit, before: paragraphs.length });
    } else {
      open.push(unit);
      if (ENDS_PARAGRAPH.test(unit)) close();
    }
  close();
  return { paragraphs, blocks };
}

/** How far `before` of `paragraphs` is through them, 0 to 1. */
function through(before: number, paragraphs: string[][]): number {
  return paragraphs.length ? before / paragraphs.length : 0;
}

/** The paragraph index as far as `at` through `count`, never before
 *  `from`. */
function at(fraction: number, count: number, from: number): number {
  return Math.max(from, Math.round(fraction * count));
}
