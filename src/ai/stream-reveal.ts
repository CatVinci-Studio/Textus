/**
 * Paces streamed text onto the screen, one animation frame at a time, so a
 * bursty stream types in smoothly about TARGET_LAG_MS behind the network.
 * Display only: callers keep the received text as the real one.
 */

/** How far behind the received text the screen settles while it streams. */
const TARGET_LAG_MS = 200;

/** Received text is on screen by this long after it arrived, whatever the
 *  pace says - a large burst is not spread out for longer than this. */
const MAX_LAG_MS = 1500;

/** The fastest pace while nothing is near MAX_LAG_MS, in UTF-16 units per
 *  second: a paragraph arriving whole still visibly types in. */
const MAX_RATE = 1000;

/** The slowest pace, in UTF-16 units per second: the end of a burst still
 *  moves instead of creeping a character at a time. */
const MIN_RATE = 60;

/** How long the last grapheme waits for the rest of it once nothing more arrives. */
const HOLD_LAST_MS = 350;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export class StreamReveal {
  private received = "";
  private shown = 0;
  private done = false;
  /** Where the received text ended after each update, and when. */
  private arrivals: { end: number; at: number }[] = [];
  private lastArrival = 0;
  private lastTick: number | null = null;
  /** Units earned but not yet revealed (a pace below one a frame). */
  private budget = 0;

  /** The whole text received so far; `done` once no more will follow. A text
   *  that replaces rather than extends the last keeps what was shown, up to its
   *  own length. */
  update(text: string, done: boolean, now: number) {
    if (text.length > this.received.length) {
      this.arrivals.push({ end: text.length, at: now });
      this.lastArrival = now;
    } else this.arrivals = this.arrivals.filter((a) => a.end <= text.length);
    this.received = text;
    this.done = done;
    // The pace counts from the first text after a pause, not across it.
    this.lastTick ??= now;
    this.shown = Math.min(this.shown, text.length);
    // Never between the two halves of a surrogate pair.
    if (isHighSurrogate(text.charCodeAt(this.shown - 1))) this.shown -= 1;
  }

  /** Advances the reveal to `now` (an animation frame's timestamp). */
  tick(now: number) {
    const elapsed = Math.max(0, now - (this.lastTick ?? now));
    this.lastTick = now;
    let due = 0;
    while (this.arrivals.length > 0 && this.arrivals[0].at <= now - MAX_LAG_MS)
      due = this.arrivals.shift()!.end;
    const backlog = this.received.length - this.shown;
    // The oldest text still waiting, shown by its deadline at an even pace.
    const oldest = this.arrivals[0];
    const catchUp = oldest
      ? ((oldest.end - this.shown) * 1000) /
        Math.max(1, oldest.at + MAX_LAG_MS - now)
      : 0;
    const rate = Math.max(
      MIN_RATE,
      catchUp,
      Math.min(MAX_RATE, (backlog * 1000) / TARGET_LAG_MS),
    );
    this.budget += (rate * elapsed) / 1000;
    const step = Math.floor(this.budget);
    this.budget -= step;
    const paced = graphemeEnd(
      this.received,
      this.shown,
      this.shown + step,
      !this.done && now - this.lastArrival < HOLD_LAST_MS,
    );
    // Held back (the last grapheme) or out of text: what wasn't spent
    // must not pour out all at once when the next delta lands.
    if (paced < this.shown + step) this.budget = 0;
    const overdue = graphemeEnd(this.received, this.shown, due, false);
    this.shown = Math.max(paced, overdue);
    if (this.caughtUp) {
      this.budget = 0;
      this.lastTick = null;
    }
  }

  /** What is on screen now. */
  get text(): string {
    return this.received.slice(0, this.shown);
  }

  /** Everything received so far is on screen. */
  get caughtUp(): boolean {
    return this.shown >= this.received.length;
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * The first grapheme boundary at or past `want`, counting from `from`. With
 * `holdLast` the last grapheme stays back: a joiner, combining mark or skin
 * tone may still arrive.
 */
function graphemeEnd(
  text: string,
  from: number,
  want: number,
  holdLast: boolean,
): number {
  if (want <= from) return from;
  let end = from;
  for (const { index, segment } of graphemes.segment(text.slice(from))) {
    const next = from + index + segment.length;
    if (holdLast && next >= text.length) break;
    end = next;
    if (end >= want) break;
  }
  return end;
}
