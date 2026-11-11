import { easing, type EasingToken } from "../motion/motion";

/** An easing token as a function of time (0 to 1), for motion driven a
 *  frame at a time: the same curve CSS draws, its linear() spring or its
 *  cubic-bezier. */
export function easingFn(token: EasingToken): (t: number) => number {
  return parseEasing(easing(token));
}

function parseEasing(value: string): (t: number) => number {
  const linear = /^linear\((.*)\)$/s.exec(value.trim());
  if (linear) return linearStops(linear[1]);
  const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(value.trim());
  if (bezier) {
    const [a, b, c, d] = bezier[1].split(",").map(Number);
    return cubicBezier(a, b, c, d);
  }
  return (t) => t;
}

/** linear()'s stops, evenly spaced (Textus's springs give no positions). */
function linearStops(list: string): (t: number) => number {
  const stops = list.split(",").map((s) => parseFloat(s));
  const last = stops.length - 1;
  return (t) => {
    if (t <= 0) return stops[0];
    if (t >= 1) return stops[last];
    const at = t * last;
    const i = Math.floor(at);
    return stops[i] + (stops[i + 1] - stops[i]) * (at - i);
  };
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const curve = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // The curve's parameter for time t, by bisection: monotonic in x.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (curve(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return curve(y1, y2, (lo + hi) / 2);
  };
}
