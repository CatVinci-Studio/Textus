import { alignRun, ENDS_PARAGRAPH } from "./sentence-diff";
import { MATCH, similarity } from "./sentence-similarity";
import { diffUnits, splitUnits } from "./unit-diff";

/**
 * A rewrite laid out sentence by sentence while it is still streaming in,
 * so each sentence shows in its final place as soon as it is written: the
 * struck original with its replacement beside it, or nothing for a
 * sentence kept as it was. Without it the whole original was struck, the
 * new text streamed after it as one block, and only the end of the stream
 * re-laid it out into sentences (1.1).
 *
 * The completed sentences of the new text are diffed against the original
 * the way the finished rewrite is (`diffUnits`), except for the
 * last run of changes: the originals the new text hasn't reached yet are
 * not deletions, they are still to come. Once the stream is done the
 * layout is exactly `diffSentences`, the one the finished proposal is shown
 * with, so nothing moves when it settles.
 *
 * Pure: the plugin (pending-edit-plugin.ts) turns the indices into
 * document ranges.
 */

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

/** How far from sentence-for-sentence the alignment of a streaming rewrite
 *  looks (alignRun's `band`): it runs once per completed sentence, and a
 *  rewrite goes through its original in order. */
const BAND = 8;

/**
 * How many of `before` the new sentences `after` cover: an alignment like
 * `alignRun`'s, with skipped originals penalized and the originals after
 * the last one paired left out for free. The fewest when several score the
 * same. Banded: a few new sentences never reach far.
 */
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
        // Every original reached costs SKIP: a pair has to be clearly the
        // same sentence rewritten to reach it, and a loose likeness (two
        // unrelated English sentences share many bigrams) doesn't.
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

/**
 * How many of `before` the paragraphs `after` has finished cover, one for
 * one, when they read nothing like them - a translation, a rewrite in
 * other words - and likeness can't tell (reachedPrefix found none of it):
 * the new paragraphs went into the document ahead of every original until
 * the rewrite was done (rc.6). Zero while they read like the originals:
 * likeness places those, and a paragraph split in two would strike one too
 * many.
 */
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

/**
 * The layout of `text` (the new text as far as it has arrived) against the
 * original's sentences. `done`: no more will come, the last sentence is
 * complete and every original not matched is deleted. `reachedAtLeast`:
 * what an earlier layout reached - a sentence once reached is not handed
 * back to "still to come" by a later one.
 */
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
  // Too little to tell which original it rewrites, or whether it is one of
  // its own: shown a moment later, in its place, rather than now in one
  // place and then in another.
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
