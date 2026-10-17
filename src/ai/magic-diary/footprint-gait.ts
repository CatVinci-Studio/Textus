/** A continuous clockwise rounded rectangle, measured in pixels of travel. */
export const WALKER_ARRIVED_EVENT = "textus:magic-diary-arrived";
export const STEP_MS = 650;
/** The pace of a walker hurrying to the line it was called to. */
export const DASH_STEP_MS = 150;
export const STRIDE = 22;
export interface Point {
  x: number;
  y: number;
  heading: number;
}

function bounds(w: number, h: number) {
  const left = Math.min(38, w / 6);
  const top = Math.min(96, h / 4);
  const right = Math.max(left + 1, w - left);
  const bottom = Math.max(top + 1, h - 40);
  const r = Math.min(40, (right - left) / 4, (bottom - top) / 4);
  return {
    left,
    top,
    right,
    bottom,
    r,
    horizontal: right - left - 2 * r,
    vertical: bottom - top - 2 * r,
  };
}
export function orbitLength(w: number, h: number) {
  const b = bounds(w, h);
  return 2 * (b.horizontal + b.vertical) + 2 * Math.PI * b.r;
}
export function orbitPoint(w: number, h: number, distance: number): Point {
  const b = bounds(w, h);
  const total = orbitLength(w, h);
  let d = ((distance % total) + total) % total;
  const arc = (Math.PI * b.r) / 2;
  const segments = [
    b.horizontal,
    arc,
    b.vertical,
    arc,
    b.horizontal,
    arc,
    b.vertical,
    arc,
  ];
  let index = 0;
  while (index < 7 && d >= segments[index]) {
    d -= segments[index];
    index++;
  }
  switch (index) {
    case 0:
      return { x: b.left + b.r + d, y: b.top, heading: 0 };
    case 2:
      return { x: b.right, y: b.top + b.r + d, heading: 90 };
    case 4:
      return { x: b.right - b.r - d, y: b.bottom, heading: 180 };
    case 6:
      return { x: b.left, y: b.bottom - b.r - d, heading: 270 };
    default: {
      const corner = (index - 1) / 2;
      const angle = -Math.PI / 2 + (corner * Math.PI) / 2 + d / b.r;
      const cx = corner < 2 ? b.right - b.r : b.left + b.r;
      const cy = corner === 0 || corner === 3 ? b.top + b.r : b.bottom - b.r;
      return {
        x: cx + Math.cos(angle) * b.r,
        y: cy + Math.sin(angle) * b.r,
        heading: corner * 90 + ((d / b.r) * 180) / Math.PI,
      };
    }
  }
}

/** Advance by a physical distance, independent of journey length or time. */
export function stepToward(from: Point, to: Point, budget = STRIDE) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const remaining = Math.hypot(dx, dy);
  const moved = Math.min(budget, remaining);
  const arrived = remaining <= budget;
  const t = remaining ? moved / remaining : 1;
  return {
    point: {
      x: arrived ? to.x : from.x + dx * t,
      y: arrived ? to.y : from.y + dy * t,
      heading: remaining ? (Math.atan2(dy, dx) * 180) / Math.PI : from.heading,
    },
    moved,
    arrived,
  };
}
