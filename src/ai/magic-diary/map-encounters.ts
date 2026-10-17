import { STRIDE } from "./footprint-gait";

export type VisitorKind = "wanderer" | "wisp" | "beast";
export interface Encounter {
  id: number;
  kind: VisitorKind;
  distance: number;
  phase: "approaching" | "greeting" | "departing";
  ticks: number;
}
export function createEncounter(
  id: number,
  walker: number,
  perimeter: number,
  random: number,
): Encounter {
  const variant = Math.min(2, Math.floor(random * 3));
  return {
    id,
    kind: (["wanderer", "wisp", "beast"] as const)[variant],
    distance: (walker + (6 + Math.floor(random * 5)) * STRIDE) % perimeter,
    phase: "approaching",
    ticks: 0,
  };
}
export function advanceEncounter(
  visitor: Encounter,
  walker: number,
  perimeter: number,
): Encounter | null {
  if (visitor.phase === "greeting") {
    const ticks = visitor.ticks + 1;
    return {
      ...visitor,
      ticks: ticks < 4 ? ticks : 0,
      phase: ticks < 4 ? "greeting" : "departing",
    };
  }
  const distance =
    (((visitor.distance - STRIDE) % perimeter) + perimeter) % perimeter;
  if (visitor.phase === "departing") {
    return visitor.ticks >= 5
      ? null
      : { ...visitor, distance, ticks: visitor.ticks + 1 };
  }
  const gap = (((distance - walker) % perimeter) + perimeter) % perimeter;
  return {
    ...visitor,
    distance,
    phase:
      Math.min(gap, perimeter - gap) <= STRIDE * 2 + 0.001
        ? "greeting"
        : "approaching",
    ticks: 0,
  };
}
