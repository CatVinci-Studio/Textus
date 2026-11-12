/** A box in pixels, relative to what it is placed in. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `a` to `b` by `t` (0 to 1). */
export function between(a: Rect, b: Rect, t: number): Rect {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  };
}

export function sameRect(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  );
}

/** Placed absolutely at `r`. */
export function rectStyle(r: Rect) {
  return {
    position: "absolute" as const,
    left: r.x,
    top: r.y,
    width: r.w,
    height: r.h,
  };
}
