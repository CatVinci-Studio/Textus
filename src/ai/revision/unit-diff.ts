import { splitBlocks } from "../doc-blocks";
import { formKey, wholeBlockKind } from "./markdown-forms";
import {
  diffSentenceLists,
  ENDS_PARAGRAPH,
  splitSentences,
  type SentenceHunk,
} from "./sentence-diff";

/**
 * A rewrite diffed as the document is built: blocks first, then sentences.
 * The finished rewrite (diffSentences) and one still streaming in
 * (sentence-stream.ts) both come through diffUnits, so a rule for a kind
 * of block is written once.
 */

/**
 * What a rewrite is compared by: its sentences, and each block that isn't
 * sentences (wholeBlockKind: a picture, a table, a code block…) as one
 * unit. Joined, the units are `text` again. Split into "sentences", a
 * block was paired with the paragraphs beside it - a table's rows shown as
 * words, a picture's change with no text to find in the document - and a
 * rewrite of a whole document with one in it became one block and one
 * card (rc.6).
 *
 * The blocks are doc-blocks.ts's, the split the model is shown. A unit is
 * whole exactly when wholeBlockKind says so: a line of a paragraph that
 * reads like one (a picture on its own line under a caption) stays with
 * the sentence before it.
 */
export function splitUnits(text: string): string[] {
  const blocks = splitBlocks(text);
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
 *  `before` are originals from `start` on (sentence-stream.ts). */
export type AlignTail = (
  before: string[],
  after: string[],
  start: number,
) => { before: string; after: string }[];

/**
 * The hunks of a rewrite: the units (splitUnits) of `a` against those of
 * `b`, every hunk the same or a change.
 *
 * Whole blocks are where the two sides meet: with the same such blocks in
 * the same order on each side, the sentences between two of them are
 * diffed against the sentences between the same two, and each block is a
 * hunk of its own - kept, or changed whole. A finished rewrite that added
 * or dropped one is met at the blocks it kept (diffByBlocks): never one
 * change for the whole of it.
 *
 * `tail`: `b` is a stream so far. Its blocks need only start the same way,
 * and the run of changes it ends with is aligned by `tail`, which leaves
 * out the originals not reached yet instead of calling them deleted.
 */
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

/**
 * A finished rewrite whose whole blocks don't line up with the original's
 * - it added or dropped a table, a code block - met at the blocks it kept:
 * the most blocks of the same kinds, in order, on both sides, one written
 * the same counting for more (keptPairs). Between two of them, the
 * sentences are diffed as between any two blocks, and a block only one
 * side has is a change of its own: dropped, or added. Diffed in one
 * instead, a dropped block and the paragraphs around it were one change,
 * and a whole document one card.
 */
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

/**
 * The blocks of `a` and `b` paired in order, the pairing that scores most:
 * a pair of one kind 1, written the same 2 - so a kept block meets its
 * copy, not a changed block of its kind beside it.
 */
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

/**
 * Units between two blocks both sides kept, with blocks only one side has.
 * Each side is its paragraphs, with its blocks standing between them; the
 * two are laid on one line from start to end, as far through their
 * paragraphs as each block stands, and cut at every block of either side.
 * Each stretch's paragraphs are diffed against the other side's, and each
 * block is dropped or added where it stands - so no change runs across a
 * block, and both sides read in their order.
 */
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
