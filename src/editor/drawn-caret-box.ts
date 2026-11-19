/** The caret's height, in the block's text size. */
const CARET_EM = 1.25;
/** Its width on screen, whatever the document's zoom. */
const CARET_PX = 2;

interface Box {
  top: number;
  bottom: number;
  left: number;
}

interface CaretPlace {
  /** Where the browser (or the editor) puts the caret, on screen. */
  at: Box;
  /** A picture beside the caret, on screen: the caret stands as tall. */
  picture: { top: number; height: number } | null;
  /** The block's text size in its own units; 0 when there is none. */
  fontSize: number;
  /** The document's zoom. */
  zoom: number;
  dpr: number;
  /** The editor's top left corner, on screen. */
  root: { left: number; top: number };
}

/**
 * Where the drawn caret goes, in the editor's own units: on whole screen
 * pixels (its left, top, width and height) and as wide on screen at any
 * zoom; in between, or grown with the zoom, it drew thick and soft.
 */
export function caretBox(place: CaretPlace) {
  const { at, picture, fontSize, zoom, dpr, root } = place;
  const onPixel = (v: number) => Math.round(v * dpr) / dpr;
  const tall = onPixel(
    picture
      ? picture.height
      : fontSize
        ? fontSize * CARET_EM * zoom
        : at.bottom - at.top,
  );
  const middle = picture
    ? picture.top + picture.height / 2
    : (at.top + at.bottom) / 2;
  const top = onPixel(middle - tall / 2);
  return {
    x: (onPixel(at.left) - root.left) / zoom,
    y: (top - root.top) / zoom,
    height: tall / zoom,
    width: Math.max(1, Math.round(CARET_PX * dpr)) / dpr / zoom,
  };
}
