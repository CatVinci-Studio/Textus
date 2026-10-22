import { splitBlocks } from "../doc-blocks";
import { formKey, wholeBlockKind } from "./markdown-forms";
import {
  diffSentenceLists,
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
 * hunk of its own - kept, or changed whole. Otherwise (the rewrite added
 * or dropped one) all units are diffed in one.
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
        ? { kind: "same", text: blockB }
        : { kind: "change", before: blockA, after: blockB },
    );
  }
}

/** The hunks of a finished rewrite of `before` into `after` (diffUnits). */
export function diffSentences(before: string, after: string): SentenceHunk[] {
  return diffUnits(splitUnits(before), splitUnits(after));
}
