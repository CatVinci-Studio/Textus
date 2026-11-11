/**
 * Which place a drag means, given the one under the pointer: a place is
 * taken once the pointer has rested on it a moment (longer for one that
 * opens a new island), and not while the pointer is sweeping past - so the
 * layout doesn't flicker through every place on the way, and snaps to the
 * one aimed at.
 */

/** How long the pointer rests on a place before it is taken (ms). */
const DWELL = 90;
/** The same for a place that opens a new island, the dearer change. */
const SPLIT_DWELL = 150;
/** Faster than this (px per ms) the pointer is passing through. */
const SWEEPING = 1.5;

interface DropIntent {
  /**
   * The place under the pointer is `key` (null: none; `opens`: it opens a
   * new island). Returns the place to show now, and when to ask again if
   * the answer may change without the pointer moving.
   */
  settle(
    key: string | null,
    opens: boolean,
    x: number,
    y: number,
    now?: number,
  ): { shown: string | null; again?: number };
  /** The place shown. */
  readonly shown: string | null;
}

export function dropIntent(): DropIntent {
  let shown: string | null = null;
  let aiming: { key: string | null; since: number; opens: boolean } | null =
    null;
  let last: { x: number; y: number; at: number } | null = null;
  return {
    get shown() {
      return shown;
    },
    settle(key, opens, x, y, now = performance.now()) {
      const speed = last
        ? Math.hypot(x - last.x, y - last.y) / Math.max(1, now - last.at)
        : 0;
      last = { x, y, at: now };
      if (key === shown) {
        aiming = null;
        return { shown };
      }
      if (!aiming || aiming.key !== key) aiming = { key, since: now, opens };
      // Sweeping past: the place in hand stays, the clock starts again.
      if (speed > SWEEPING) {
        aiming.since = now;
        return { shown, again: aiming.opens ? SPLIT_DWELL : DWELL };
      }
      const wait = (aiming.opens ? SPLIT_DWELL : DWELL) - (now - aiming.since);
      if (wait > 0) return { shown, again: wait };
      shown = key;
      aiming = null;
      return { shown };
    },
  };
}
