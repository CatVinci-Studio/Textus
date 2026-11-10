import type { Slot } from "./tab-strip";

/**
 * Each pane's row of tabs as its strip last laid them out: their places
 * along it and how far it is scrolled, for a drag to find a slot by
 * without measuring the page.
 */
export interface StripPlaces {
  ids: readonly string[];
  slots: readonly Slot[];
  scrolled: () => number;
}

const strips = new Map<string | null, StripPlaces>();

export function setStripPlaces(pane: string | null, places: StripPlaces): void {
  strips.set(pane, places);
}

/** Pane `pane`'s strip gone - unless another strip has taken it since. */
export function dropStripPlaces(
  pane: string | null,
  scrolled: StripPlaces["scrolled"],
): void {
  if (strips.get(pane)?.scrolled === scrolled) strips.delete(pane);
}

/** Pane `pane`'s tabs (null: the one row unsplit), if laid out. */
export function stripPlaces(pane: string | null): StripPlaces | undefined {
  return strips.get(pane);
}

/** Where a pane's row starts its tabs in the viewport, unscrolled: told by
 *  the layout, which places the rows (layout/row-insets.ts). */
let originOf: (pane: string | null) => number | null = () => null;

export function setStripOrigins(
  resolve: (pane: string | null) => number | null,
): void {
  originOf = resolve;
}

export function stripOrigin(pane: string | null): number | null {
  return originOf(pane);
}
