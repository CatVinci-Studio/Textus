import { alignRun, ENDS_PARAGRAPH } from "./sentence-diff";
import { MATCH, similarity } from "./sentence-similarity";
import { diffUnits, splitUnits } from "./unit-diff";

/** A streaming rewrite laid out sentence by sentence, each in its final
 *  place as soon as it is written. Originals not reached yet are still to
 *  come, not deleted; once done, the layout equals `diffSentences`. */

/** One piece of the layout, over original sentences [start, end). */
export type StreamPiece =
  | { kind: "same"; start: number; end: number }
  | {
      kind: "change";
      start: number;
      end: number;
      before: string;
      after: string;
    };

/** The sentence being written. */
export interface StreamPartial {
  text: string;
  /** The original sentence it rewrites - struck while it is written - or
   *  null when it reads as a sentence of its own, written before original
   *  `at` (`at` = the original's length: after the last one). */
  rewrites: number | null;
  at: number;
}

export interface StreamLayout {
  pieces: StreamPiece[];
  /** The original sentences the stream has reached: [0, reached). The rest
   *  are still plain text. */
  reached: number;
  /** Null when there is none, or while it repeats an original word for word
   *  so far: a sentence that is being kept shows nothing. */
  partial: StreamPartial | null;
}

/** Reaching an original costs this much in the prefix alignment, so a
 *  new sentence only vaguely like one far ahead doesn't strike everything
 *  in between; a word-for-word match still can. */
const SKIP = 0.15;

/** How long a partial sentence has to be (`weight`) before it is placed:
 *  shorter, it can't be told which original it rewrites. */
const PARTIAL_JUDGED = 12;

/** How far from sentence-for-sentence the alignment looks: it runs once per
 *  completed sentence, and a rewrite goes through its original in order. */
const BAND = 8;

/** How many of `before` the new sentences `after` cover, skipped originals
 *  penalized and trailing ones free. The fewest on a tie. */
export function reachedPrefix(before: string[], after: string[]): number {
  const n = after.length;
  if (n === 0 || before.length === 0) return 0;
  const m = Math.min(before.length, 2 * n + 4);
  const best: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(-Infinity),
  );
  best[0][0] = 0;
  const moves: [number, number][] = [
    [1, 1],
    [1, 2],
    [2, 1],
    [1, 0],
    [0, 1],
  ];
  for (let i = 0; i <= m; i++)
    for (let j = 0; j <= n; j++) {
      const here = best[i][j];
      if (here === -Infinity) continue;
      for (const [di, dj] of moves) {
        const ni = i + di;
        const nj = j + dj;
        if (ni > m || nj > n || Math.abs(ni - nj) > BAND) continue;
        // Each original reached costs SKIP, so a loose likeness (unrelated
        // English sentences share many bigrams) doesn't reach it.
        let gain = -SKIP * di;
        if (di > 0 && dj > 0) {
          const sim = similarity(
            before.slice(i, ni).join(""),
            after.slice(j, nj).join(""),
          );
          if (sim < MATCH) continue;
          gain += sim - (di + dj > 2 ? 0.05 : 0);
        }
        if (here + gain > best[ni][nj]) best[ni][nj] = here + gain;
      }
    }
  let reached = 0;
  for (let i = 1; i <= m; i++) if (best[i][n] > best[reached][n]) reached = i;
  return Math.max(reached, paragraphsReached(before, after));
}

/** How many of `before` the finished paragraphs of `after` cover one for
 *  one, when likeness can't tell (a translation). Zero while they read alike,
 *  as a paragraph split in two would strike one too many. */
function paragraphsReached(before: string[], after: string[]): number {
  const finished = after.filter((s) => ENDS_PARAGRAPH.test(s)).length;
  if (finished === 0) return 0;
  let paragraphs = 0;
  let reach = 0;
  while (reach < before.length && paragraphs < finished)
    if (ENDS_PARAGRAPH.test(before[reach++])) paragraphs++;
  if (paragraphs < finished) return 0;
  const written = after.join("");
  return similarity(before.slice(0, reach).join(""), written) < MATCH
    ? reach
    : 0;
}

/** The layout of `text` so far against the original's sentences. `done`:
 *  unmatched originals are deleted. `reachedAtLeast`: what was reached
 *  before is never handed back. */
export function alignStream(
  original: string[],
  text: string,
  done: boolean,
  reachedAtLeast = 0,
): StreamLayout {
  let sentences = splitUnits(text);
  // Until the stream ends, the last piece may still grow: a closing quote,
  // the space after the stop, or the rest of the sentence.
  let partialText = "";
  if (!done && sentences.length > 0) {
    partialText = sentences[sentences.length - 1];
    sentences = sentences.slice(0, -1);
  }
  const { pieces, reached } = alignCompleted(
    original,
    sentences,
    done,
    reachedAtLeast,
  );
  return {
    pieces,
    reached,
    partial: done ? null : partialFor(original, partialText.trim(), reached),
  };
}

/** `alignStream`'s pieces for the completed sentences only - the costly
 *  part, which the plugin runs once per completed sentence. */
export function alignCompleted(
  original: string[],
  sentences: string[],
  done: boolean,
  reachedAtLeast = 0,
): Omit<StreamLayout, "partial"> {
  let reached = original.length;
  const hunks = diffUnits(
    original,
    sentences,
    done
      ? undefined
      : (before, after, start) => {
          const take = Math.min(
            before.length,
            Math.max(reachedPrefix(before, after), reachedAtLeast - start),
          );
          reached = start + take;
          return alignRun(before.slice(0, take), after, BAND);
        },
  );
  const pieces: StreamPiece[] = [];
  let i = 0;
  for (const h of hunks) {
    if (h.kind === "same") {
      pieces.push({ kind: "same", start: i, end: i + 1 });
      i += 1;
      continue;
    }
    // A change's original is whole sentences in a row: count them.
    const start = i;
    let length = 0;
    while (length < h.before.length && i < original.length)
      length += original[i++].length;
    pieces.push({ ...h, start, end: i });
  }
  return { pieces, reached };
}

/** Where the sentence being written goes, `next` being the first original
 *  not reached yet. */
export function partialFor(
  original: string[],
  text: string,
  next: number,
): StreamPartial | null {
  if (!text) return null;
  const ahead = Math.min(next + LOOK_AHEAD, original.length);
  // Word for word one of the next originals so far: most likely kept, and
  // a kept sentence shows nothing - nothing to take back if it is.
  for (let k = next; k < ahead; k++)
    if (original[k].trim().startsWith(text)) return null;
  if (next >= original.length)
    return { text, rewrites: null, at: original.length };
  // Too little to tell which original it rewrites: shown a moment later in
  // its place, rather than jumping.
  if (weight(text) < PARTIAL_JUDGED) return null;
  // The original it is most like among the next few, the nearest winning
  // a near tie: a rewrite that drops a sentence goes on to the one after.
  let best = -1;
  let bestScore = MATCH * 0.6;
  for (let k = next; k < ahead; k++) {
    const target = original[k].trim();
    const score =
      similarity(text, target.slice(0, Math.ceil(text.length * 1.3))) -
      0.1 * (k - next);
    if (score > bestScore) {
      best = k;
      bestScore = score;
    }
  }
  return best === -1
    ? { text, rewrites: null, at: next }
    : { text, rewrites: best, at: best };
}

/** Originals ahead a partial sentence is compared with. */
const LOOK_AHEAD = 3;

/** Length as reading goes: a CJK character says about as much as two
 *  Latin ones. */
function weight(text: string): number {
  let n = 0;
  for (const ch of text) n += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  return n;
}

/** CJK punctuation and ideographs, Hangul, full-width forms. */
function isWide(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}
