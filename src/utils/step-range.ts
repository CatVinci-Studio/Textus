/** A setting's numeric range: its ends, and the step a click moves it by,
 *  whose decimal places are the precision a value is kept to. */
export interface StepRange {
  min: number;
  max: number;
  step: number;
}

/** The value inside the range, rounded to the step's decimal places - not
 *  snapped to the step, so a typed 1.53 stays 1.53. */
export function inRange(value: number, { min, max, step }: StepRange): number {
  const factor = 10 ** (String(step).split(".")[1]?.length ?? 0);
  return Math.round(Math.min(max, Math.max(min, value)) * factor) / factor;
}

/** A stored value read back: a number, or one in a string, kept in range;
 *  anything else is `fallback`. */
export function storedInRange<T>(
  value: unknown,
  range: StepRange,
  fallback: T,
): number | T {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n)
    ? inRange(n, range)
    : fallback;
}
