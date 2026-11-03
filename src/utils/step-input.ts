import { inRange, type StepRange } from "./step-range";

// What a number stepper does with keys and typing; apart from step-range.ts,
// which reading the saved settings needs at startup.

/** One step up or down from `base`, onto the step's grid: 16.5 goes to 17
 *  or 16, not 17.5. */
export function stepFrom(base: number, by: -1 | 1, range: StepRange): number {
  const k = base / range.step;
  const n =
    Math.abs(k - Math.round(k)) < 1e-6
      ? Math.round(k) + by
      : by > 0
        ? Math.ceil(k)
        : Math.floor(k);
  return inRange(n * range.step, range);
}

/** What is typed in a number field: a number, null for an empty field, or
 *  undefined for anything else. A decimal comma reads as a point. */
export function readTyped(text: string): number | null | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}
