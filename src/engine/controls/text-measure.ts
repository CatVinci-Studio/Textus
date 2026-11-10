/**
 * How wide a line of text draws in a font, without laying it out: measured
 * on a canvas and remembered, so asking in a render costs a lookup.
 */

/** Remembered widths per font; emptied when it has grown this far. */
const MOST = 2000;
const widths = new Map<string, Map<string, number>>();
let remembered = 0;
let context: CanvasRenderingContext2D | null | undefined;

function forget() {
  widths.clear();
  remembered = 0;
}

function canvas(): CanvasRenderingContext2D | null {
  if (context === undefined) {
    context = document.createElement("canvas").getContext("2d");
    // A font that arrives later draws the same name at another width.
    document.fonts?.addEventListener?.("loadingdone", forget);
  }
  return context;
}

/** The width of `text` in px, drawn in `font` (a CSS font shorthand, as an
 *  element's computed `font` is); null where no canvas can tell. */
export function textWidth(text: string, font: string): number | null {
  const known = widths.get(font)?.get(text);
  if (known !== undefined) return known;
  const pen = canvas();
  if (!pen) return null;
  pen.font = font;
  const width = pen.measureText(text).width;
  if (remembered >= MOST) forget();
  let ofFont = widths.get(font);
  if (!ofFont) widths.set(font, (ofFont = new Map()));
  ofFont.set(text, width);
  remembered++;
  return width;
}

/** An element's font as a shorthand a canvas takes. */
export function fontOf(el: Element): string {
  const style = getComputedStyle(el);
  return (
    style.font ||
    `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  );
}
