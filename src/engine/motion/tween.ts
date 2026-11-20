/**
 * One eased run from 0 to 1 over `span` ms: `draw` gets the eased progress
 * each frame, the last one 1. Returns a stop that cancels what is left.
 * The frame clock drives many runs at once; this is for a single one.
 */
export function tween(
  span: number,
  ease: (t: number) => number,
  draw: (progress: number) => void,
): () => void {
  let start: number | null = null;
  let frame = 0;
  const tick = (now: number) => {
    start ??= now;
    const t = span > 0 ? Math.min(1, (now - start) / span) : 1;
    draw(ease(t));
    frame = t < 1 ? requestAnimationFrame(tick) : 0;
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
