/**
 * The reveal move: text that arrives in pieces goes on screen behind it at
 * a steady pace - a stream typed in (StreamReveal), or sentences landing
 * one at a time on the mark's beat (the AI's UnitReveal). Display only.
 */
export interface Reveal {
  /** Advances to `now`, an animation frame's timestamp. */
  tick(now: number): void;
  /** Everything received so far is on screen. */
  readonly caughtUp: boolean;
}

/** Ticks `reveal` once a frame, `drawn` after each, until it has caught
 *  up; then `done`. Returns what stops it early. */
export function revealFrames(
  reveal: Reveal,
  drawn: () => void,
  done?: () => void,
): () => void {
  let frame = requestAnimationFrame(function step(now) {
    reveal.tick(now);
    drawn();
    if (!reveal.caughtUp) frame = requestAnimationFrame(step);
    else done?.();
  });
  return () => cancelAnimationFrame(frame);
}
