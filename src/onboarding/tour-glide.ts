import { useEffect, useRef, useState } from "react";
import { easingFn } from "../engine/frame/easing";
import { duration, motionAllowed } from "../engine/motion/motion";
import type { Box } from "./tour-place";

/** What the tour draws: the lit hole (none: the window dimmed whole) and
 *  the card's corner. */
export interface TourFrame {
  hole: Box | null;
  card: { left: number; top: number };
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

function mixBox(a: Box, b: Box, k: number): Box {
  return {
    left: mix(a.left, b.left, k),
    top: mix(a.top, b.top, k),
    width: mix(a.width, b.width, k),
    height: mix(a.height, b.height, k),
  };
}

/** The frame `k` of the way from `a` to `b`. A hole that wasn't there
 *  appears where it goes rather than gliding in from nowhere. */
function mixFrame(a: TourFrame, b: TourFrame, k: number): TourFrame {
  return {
    hole: b.hole && (a.hole ? mixBox(a.hole, b.hole, k) : b.hole),
    card: {
      left: mix(a.card.left, b.card.left, k),
      top: mix(a.card.top, b.card.top, k),
    },
  };
}

/** How often the lit part is looked up again; cheap enough to keep the
 *  tour from watching the whole page for changes. */
const RECHECK_MS = 250;

/** The rectangle of the first element matching `selector` that shows,
 *  followed as the window changes; null with none. */
export function useTargetBox(selector: string | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (!selector) {
      setBox(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = [...document.querySelectorAll(selector)]
        .map((el) => el.getBoundingClientRect())
        .find((r) => r.width > 0 && r.height > 0);
      const next = rect
        ? {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }
        : null;
      setBox((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const timer = window.setInterval(schedule, RECHECK_MS);
    const events = ["resize", "scroll", "transitionend"];
    for (const name of events) window.addEventListener(name, schedule, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearInterval(timer);
      for (const name of events)
        window.removeEventListener(name, schedule, true);
    };
  }, [selector]);
  return box;
}

/** Moves the drawn frame to `target` on the window's settle span and curve,
 *  writing each frame through `draw`; at once with reduced motion. */
export function useGlide(
  target: TourFrame,
  draw: (frame: TourFrame) => void,
): void {
  const shown = useRef<TourFrame | null>(null);
  const key = JSON.stringify(target);
  useEffect(() => {
    const to = JSON.parse(key) as TourFrame;
    const from = shown.current;
    if (!from || !motionAllowed()) {
      shown.current = to;
      draw(to);
      return;
    }
    const ease = easingFn("--ease-settle");
    const span = duration("--dur-settle");
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / span);
      const frame = mixFrame(from, to, ease(t));
      shown.current = frame;
      draw(frame);
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [key, draw]);
}
