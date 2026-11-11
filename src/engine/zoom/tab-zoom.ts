import { tabElement } from "../layout/tab-element";
/**
 * Each document tab's own zoom, when it has one (zoom not together): kept
 * here and painted as its view's `--content-zoom`, so a view drawn again
 * comes back at its zoom. A tab without one takes the window's.
 */
const zooms = new Map<string, number>();

const viewOf = (id: string) => tabElement(id);

/** The tab's own zoom, or undefined when it takes the window's. */
export function tabZoom(id: string): number | undefined {
  return zooms.get(id);
}

export function setTabZoom(id: string, zoom: number): void {
  zooms.set(id, zoom);
  viewOf(id)?.style.setProperty("--content-zoom", String(zoom));
}

/** Every tab back to the window's zoom. */
export function clearTabZooms(): void {
  for (const id of zooms.keys())
    viewOf(id)?.style.removeProperty("--content-zoom");
  zooms.clear();
}

/** The style a tab's view is drawn with for its zoom. */
export function tabZoomStyle(id: string): Record<string, string> | undefined {
  const zoom = zooms.get(id);
  return zoom === undefined ? undefined : { "--content-zoom": String(zoom) };
}
