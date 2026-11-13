/**
 * A pinch's live look. Zooming the document lays the whole of it out again,
 * which a long one can't do every frame; while the fingers move, the
 * rendered column is scaled on the compositor instead, and the real zoom
 * lands once, when the pinch ends (useZoom.ts).
 */
export interface ZoomPreview {
  tab: HTMLElement;
  /** The zoom the pinch began at. */
  base: number;
  /** The viewport line it holds still, as the real zoom will. */
  line: number;
  column: HTMLElement;
}

/** A preview for `tab` about viewport line `y`; null where the real zoom is
 *  drawn live: Source mode and split view (CodeMirror lays out only what
 *  shows; the two panes follow each other). */
export function startPreview(
  tab: HTMLElement,
  base: number,
  y: number,
): ZoomPreview | null {
  if (tab.querySelector(".source-view, .split-view")) return null;
  const column = tab.querySelector<HTMLElement>(
    ".editor-scroll .editor-content",
  );
  if (!column) return null;
  const box = column.getBoundingClientRect();
  // Across, about the column's middle: the zoomed column stays centred.
  column.style.transformOrigin = `50% ${y - box.top}px`;
  column.style.willChange = "transform";
  return { tab, base, line: y, column };
}

/** The column drawn at `zoom`, before it is laid out at it. */
export function showPreview(preview: ZoomPreview, zoom: number): void {
  preview.column.style.transform = `scale(${zoom / preview.base})`;
}

/** Back to the column as laid out: called just before the real zoom. */
export function endPreview(preview: ZoomPreview): void {
  const { style } = preview.column;
  style.transform = "";
  style.transformOrigin = "";
  style.willChange = "";
}
