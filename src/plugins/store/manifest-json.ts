/** The JSON a manifest is read from, checked piece by piece. */

/** Why a manifest was refused, in English: shown as is in Settings, for its author. */
export class ManifestError extends Error {}

export type Json = Record<string, unknown>;

export function object(value: unknown, what: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ManifestError(`${what} must be an object.`);
  return value as Json;
}

export function list(value: unknown, what: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ManifestError(`${what} must be a list.`);
  return value;
}

export function text(value: unknown, what: string, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || !value.trim())
    throw new ManifestError(`${what} must be a string.`);
  return value;
}
