import { scaledPx } from "../tokens/chrome-scale";

/** How near a scroller's top or bottom edge the pointer starts it
 *  scrolling, in pixels, and the fastest it goes, in pixels a 60 Hz frame. */
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

/** edgeStep's pace is per frame at 60 Hz; the scroll goes by time, so a
 *  120 Hz screen moves as fast as a 60 Hz one. A late frame moves no more
 *  than LONGEST_GAP_MS's worth. */
const FRAME_MS = 1000 / 60;
const LONGEST_GAP_MS = 50;

/**
 * Something dragged near a scroller's top or bottom (a selection, a block,
 * a margin pick): the scroller moves at edgeStep's pace and goes on while
 * the pointer rests there. `step` follows each frame, scrolled or not, told
 * whether the pointer is in the edge band. With `topUp`, what the web view
 * scrolled by itself since the last frame counts towards the pace, so a
 * view that scrolls on its own while selecting isn't scrolled twice.
 */
export function edgeScroll(
  scroller: () => HTMLElement | null,
  step: (rect: DOMRect | undefined, atEdge: boolean) => void,
  { topUp = false }: { topUp?: boolean } = {},
): { at: (y: number) => void; flush: () => void; stop: () => void } {
  let y = 0;
  let frame = 0;
  let then = 0;
  let carry = 0;
  let lastTop = 0;
  const run = (now: number) => {
    frame = 0;
    const el = scroller();
    const rect = el?.getBoundingClientRect();
    const pace = rect ? edgeStep(y, rect.top, rect.bottom) : 0;
    if (el && pace) {
      const gap = then ? Math.min(now - then, LONGEST_GAP_MS) : FRAME_MS;
      let want = (pace * gap) / FRAME_MS + carry;
      const own = el.scrollTop - lastTop;
      if (topUp && Math.sign(own) === Math.sign(pace)) want -= own;
      const whole = Math.sign(want) === Math.sign(pace) ? Math.trunc(want) : 0;
      carry = whole || Math.sign(want) === Math.sign(pace) ? want - whole : 0;
      if (whole) el.scrollTop += whole;
      then = now;
    } else {
      then = 0;
      carry = 0;
    }
    if (el) lastTop = el.scrollTop;
    step(rect, pace !== 0);
    if (pace) frame = requestAnimationFrame(run);
  };
  return {
    at(next) {
      y = next;
      if (frame) return;
      lastTop = scroller()?.scrollTop ?? 0;
      frame = requestAnimationFrame(run);
    },
    /** A frame still waiting runs now (the button let go before it). */
    flush() {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
      step(scroller()?.getBoundingClientRect(), false);
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      then = 0;
      carry = 0;
    },
  };
}
