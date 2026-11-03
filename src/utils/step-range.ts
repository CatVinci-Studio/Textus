/** A setting's numeric range: its ends, and the step a click moves it by,
 *  whose decimal places are the precision a value is kept to. */
export interface StepRange {
  min: number;
  max: number;
  step: number;
}

/** Decimal places of the step: 0.05 → 2. */
function places(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** The value inside the range, rounded to the step's places - not snapped
 *  to the step, so a typed 1.53 stays 1.53. */
export function inRange(value: number, range: StepRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  const factor = 10 ** places(range.step);
  return Math.round(clamped * factor) / factor;
}

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

/** A stored value read back: a number, or one in a string, kept in range;
 *  anything else is `fallback`. */
export function storedInRange<T>(
  value: unknown,
  range: StepRange,
  fallback: T,
): number | T {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? inRange(n, range) : fallback;
}

/** What is typed in a number field: a number, null for an empty field, or
 *  undefined for anything else. A decimal comma reads as a point. */
export function readTyped(text: string): number | null | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}
