import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { easingFn } from "../engine/frame/easing";
import { tween } from "../engine/motion/tween";
import { duration, motionAllowed } from "../engine/motion/motion";
import type { Box } from "./tour-place";

/** What the tour draws: the lit hole (none: the window dimmed whole), what
 *  it opened left undimmed beside it, unringed, and the card's corner, with
 *  a width when it is narrowed. */
export interface TourFrame {
  hole: Box | null;
  beside?: Box | null;
  card: { left: number; top: number; width?: number };
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
    beside: b.beside && (a.beside ? mixBox(a.beside, b.beside, k) : b.beside),
    card: {
      left: mix(a.card.left, b.card.left, k),
      top: mix(a.card.top, b.card.top, k),
      width: b.card.width,
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
 *  writing each frame through `draw`; at once with reduced motion. The
 *  first frame is drawn before paint, once `ready` (the card measured), so
 *  neither a corner nor a guess ever shows. */
export function useGlide(
  target: TourFrame,
  draw: (frame: TourFrame) => void,
  ready = true,
): void {
  const shown = useRef<TourFrame | null>(null);
  const key = JSON.stringify(target);
  useLayoutEffect(() => {
    if (!ready) return;
    const to = JSON.parse(key) as TourFrame;
    const from = shown.current;
    if (!from || !motionAllowed()) {
      shown.current = to;
      draw(to);
      return;
    }
    return tween(duration("--dur-settle"), easingFn("--ease-settle"), (p) => {
      const frame = mixFrame(from, to, p);
      shown.current = frame;
      draw(frame);
    });
  }, [key, draw, ready]);
}
