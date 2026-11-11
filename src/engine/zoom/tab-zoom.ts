import { tabElement } from "../layout/tab-element";

/**
 * The documents' zoom, its one owner: the window's, which a tab takes
 * unless it has its own (zoom not together). Painted as `--content-zoom` -
 * the window's on the page's body (off the root, whose changes mean a new
 * look), a tab's on its view - for the styles;
 * read here, never from the page.
 */
let windowZoom = 1;
const zooms = new Map<string, number>();
const listeners = new Set<() => void>();

const told = () => {
  for (const tell of listeners) tell();
};

/** Calls `changed` after any zoom changes; returns the stop. */
export function onZoom(changed: () => void): () => void {
  listeners.add(changed);
  return () => listeners.delete(changed);
}

/** The zoom new tabs start at, and every tab without its own. */
export function setWindowZoom(zoom: number): void {
  windowZoom = zoom;
  document.body.style.setProperty("--content-zoom", String(zoom));
  told();
}

/** The zoom tab `id` is drawn at; the window's for none. */
export function zoomOf(id: string | null | undefined): number {
  return (id && zooms.get(id)) || windowZoom;
}

export function setTabZoom(id: string, zoom: number): void {
  zooms.set(id, zoom);
  tabElement(id)?.style.setProperty("--content-zoom", String(zoom));
  told();
}

/** Every tab back to the window's zoom. */
export function clearTabZooms(): void {
  for (const id of zooms.keys())
    tabElement(id)?.style.removeProperty("--content-zoom");
  zooms.clear();
  told();
}

/** The tabs `ids` that follow the window keep the zoom it has now, before
 *  the window's changes: a new default is for tabs to come. */
export function keepWindowZoomIn(ids: readonly string[]): void {
  for (const id of ids) if (!zooms.has(id)) setTabZoom(id, windowZoom);
}

/** A closed tab's zoom let go. */
export function forgetTabZoom(id: string): void {
  zooms.delete(id);
}

/** The style a tab's view is drawn with for its zoom. */
export function tabZoomStyle(id: string): Record<string, string> | undefined {
  const zoom = zooms.get(id);
  return zoom === undefined ? undefined : { "--content-zoom": String(zoom) };
}
