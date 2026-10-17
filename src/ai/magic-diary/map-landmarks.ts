import type { Point } from "./footprint-gait";

export interface LandmarkVisit {
  id: number;
  event: number;
  phase: "approaching" | "active" | "departing";
  ticks: number;
}
export interface LandmarkTarget {
  id: number;
  point: Point;
}

/** Pick a nearby diversion, keeping the walk in the margins rather than
 * drawing a diagonal shortcut through the reader's writing column. */
export function chooseLandmark(
  places: LandmarkTarget[],
  from: Point,
  random: number,
): LandmarkTarget | null {
  const nearby = [...places]
    .sort(
      (a, b) =>
        Math.hypot(a.point.x - from.x, a.point.y - from.y) -
        Math.hypot(b.point.x - from.x, b.point.y - from.y),
    )
    .slice(0, 2);
  return (
    nearby[Math.min(nearby.length - 1, Math.floor(random * nearby.length))] ??
    null
  );
}
