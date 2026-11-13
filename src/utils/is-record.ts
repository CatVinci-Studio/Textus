/** Whether `value` is a plain object read from JSON: not null, not a list. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
