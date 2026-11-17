import { scaledPx } from "../tokens/chrome-scale";

/** How near a scroller's top or bottom edge the pointer starts it
 *  scrolling, in pixels, and the fastest it goes, in pixels a frame. */
const EDGE = 36;
const MAX_STEP = 40;

/**
 * Pixels a frame a pointer at `y` asks the scroller to move: more the
 * further into the edge band or past it, up to MAX_STEP; negative upwards.
 */
export function edgeStep(y: number, top: number, bottom: number): number {
  const edge = scaledPx(EDGE);
  const below = y - (bottom - edge);
  const above = top + edge - y;
  const ramp = (into: number) => Math.min(MAX_STEP, Math.ceil(into / 3));
  if (below > 0) return ramp(below);
  if (above > 0) return -ramp(above);
  return 0;
}

/**
 * Something dragged near a scroller's top or bottom (a selection, a block,
 * a margin pick): the scroller moves at edgeStep's pace and goes on while
 * the pointer rests there. `step` follows each frame, scrolled or not.
 */
export function edgeScroll(
  scroller: () => HTMLElement | null,
  step: (rect: DOMRect | undefined) => void,
): { at: (y: number) => void; flush: () => void; stop: () => void } {
  let y = 0;
  let frame = 0;
  const run = () => {
    frame = 0;
    const el = scroller();
    const rect = el?.getBoundingClientRect();
    const by = rect ? edgeStep(y, rect.top, rect.bottom) : 0;
    if (el && by) el.scrollTop += by;
    step(rect);
    if (by) frame = requestAnimationFrame(run);
  };
  return {
    at(next) {
      y = next;
      if (!frame) frame = requestAnimationFrame(run);
    },
    /** A frame still waiting runs now (the button let go before it). */
    flush() {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
      step(scroller()?.getBoundingClientRect());
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
