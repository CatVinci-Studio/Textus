/**
 * What a recording of frames (record.ts) is held to: pure checks over the
 * boxes each named block had in every painted frame. Each returns what it
 * measured, so a failing claim says by how much.
 */

/** One block in one frame, as drawn (transforms included). */
export interface FrameBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  /** Its own opacity times its ancestors'. */
  opacity: number;
  /** How wide the part of it that shows is: what its ancestors' overflow,
   *  clip paths and the window leave of it. */
  shownWidth: number;
}

export interface Frame {
  /** Milliseconds since the recording began. */
  t: number;
  /** Each target's box; null while it isn't in the page. */
  boxes: Record<string, FrameBox | null>;
}

export type Edge = "left" | "right" | "top" | "bottom";

/** A frame that broke a claim, and by how much. */
export interface Miss {
  frame: number;
  t: number;
  /** Which block, where the claim is about several. */
  name?: string;
  /** Pixels off. */
  by: number;
}

const BUDGET = 1000 / 60;

const round = (n: number) => Math.round(n * 100) / 100;

/** The largest miss, or null: what a report quotes. */
export function worst(misses: Miss[]): Miss | null {
  return misses.reduce<Miss | null>(
    (most, miss) => (!most || miss.by > most.by ? miss : most),
    null,
  );
}

/** Frames where `a`'s and `b`'s `edge` differ by more than `within` px,
 *  while both are in the page. */
export function aligned(
  frames: Frame[],
  a: string,
  b: string,
  edge: Edge,
  within = 1,
): Miss[] {
  return frames.flatMap((frame, i) => {
    const one = frame.boxes[a];
    const other = frame.boxes[b];
    if (!one || !other) return [];
    const by = Math.abs(one[edge] - other[edge]);
    return by > within ? [{ frame: i, t: frame.t, by: round(by) }] : [];
  });
}

/** Frames where the distance from `a`'s `edgeA` to `b`'s `edgeB` is more
 *  than `within` px off what it ends at: two blocks that move as one keep
 *  their gap. */
export function steadyGap(
  frames: Frame[],
  a: [name: string, edge: Edge],
  b: [name: string, edge: Edge],
  within = 1,
): Miss[] {
  const gaps = frames.map((frame) => {
    const one = frame.boxes[a[0]];
    const other = frame.boxes[b[0]];
    return one && other ? other[b[1]] - one[a[1]] : null;
  });
  const end = [...gaps].reverse().find((gap) => gap !== null);
  if (end === null || end === undefined) return [];
  return gaps.flatMap((gap, i) => {
    if (gap === null) return [];
    const by = Math.abs(gap - end);
    return by > within ? [{ frame: i, t: frames[i]!.t, by: round(by) }] : [];
  });
}

/** The furthest any edge of `name` went between two frames, in px per
 *  frame: a frame the machine dropped counts as the frames it spans. */
export function maxStep(frames: Frame[], name: string): number {
  let most = 0;
  let before: { t: number; box: FrameBox } | null = null;
  for (const frame of frames) {
    const box = frame.boxes[name];
    if (!box) {
      before = null;
      continue;
    }
    if (before) {
      const spans = Math.max(1, Math.round((frame.t - before.t) / BUDGET));
      const prev = before.box;
      const moved = Math.max(
        ...(["left", "right", "top", "bottom"] as const).map((edge) =>
          Math.abs(box[edge] - prev[edge]),
        ),
      );
      most = Math.max(most, moved / spans);
    }
    before = { t: frame.t, box };
  }
  return round(most);
}

/**
 * How much of its final width `name` shows in the first frame it can be
 * seen in (0 to 1), or null if it never shows. A block that grows in
 * starts near 0; one that pops in at its size, or fades in at it, is 1.
 */
export function firstShownShare(frames: Frame[], name: string): number | null {
  const seen = frames
    .map((frame) => frame.boxes[name])
    .filter((box): box is FrameBox => !!box && box.opacity > 0.01);
  const first = seen[0];
  const last = seen[seen.length - 1];
  if (!first || !last || last.width <= 0) return null;
  return round(first.shownWidth / last.width);
}

/** Whether `name` grows in from nothing: in its first frame on screen at
 *  most `share` of its final width shows (a first frame is already a few
 *  milliseconds into the motion). */
export function startsFromZero(
  frames: Frame[],
  name: string,
  share = 0.25,
): boolean {
  const first = firstShownShare(frames, name);
  return first !== null && first <= share;
}

/** Frames where one of `names` is more than `within` px wider or narrower
 *  than it first was: blocks that may move but never resize. */
export function sameWidth(
  frames: Frame[],
  names: string[],
  within = 0.5,
): Miss[] {
  return names.flatMap((name) => {
    const first = frames.find((frame) => frame.boxes[name])?.boxes[name];
    if (!first) return [];
    return frames.flatMap((frame, i) => {
      const box = frame.boxes[name];
      if (!box) return [];
      const by = Math.abs(box.width - first.width);
      return by > within ? [{ frame: i, t: frame.t, name, by: round(by) }] : [];
    });
  });
}
