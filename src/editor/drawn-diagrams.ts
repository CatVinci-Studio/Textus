import type { Drawn } from "./mermaid-blocks";

// Drawings shared by every editor: a tab made again (moved, or opened once
// more) shows its diagrams at once instead of their source, then a drawing.

/** How many drawings are kept, in each of the two lookups. */
export const DRAWINGS_KEPT = 200;

/** By what they were drawn for and their source. */
const byStyle = new Map<string, Drawn>();
/** The last drawn of each source, whatever for. */
const latest = new Map<string, Drawn>();

/** Puts `value` at the fresh end of `map`, the stalest let go past the bound. */
function keep(map: Map<string, Drawn>, key: string, value: Drawn) {
  map.delete(key);
  map.set(key, value);
  if (map.size > DRAWINGS_KEPT) map.delete(map.keys().next().value as string);
}

/** Keeps `drawn`, the drawing of the source kept under `key`. */
export function keepDrawing(key: string, drawn: Drawn): void {
  keep(byStyle, `${drawn.style}\n${key}`, drawn);
  keep(latest, key, drawn);
}

/** A drawing of `key` made for one of `styles`, if one is kept. */
export function drawingFor(
  key: string,
  styles: readonly string[],
): Drawn | undefined {
  for (const style of styles) {
    const drawn = byStyle.get(`${style}\n${key}`);
    if (drawn) return drawn;
  }
  return undefined;
}

/** The last drawing of `key`, for an editor that can't yet say what it
 *  draws for (it isn't laid out): its first pass replaces one that differs. */
export function lastDrawing(key: string): Drawn | undefined {
  return latest.get(key);
}
