/** The document's type as it is drawn now - the theme's, where the reader
 *  set none of their own: where a text stepper starts from. Read on demand
 *  (a render of Settings, a click), never on a hot path. */

/** content-base.css's size at the standard measure and its line height,
 *  with no document open. */
const FALLBACK_SIZE = 16.5;
const FALLBACK_LINE_HEIGHT = 1.8;

function docStyle(): CSSStyleDeclaration | null {
  const doc =
    document.querySelector('[data-active-tab="true"] .milkdown') ??
    document.querySelector(".milkdown");
  return doc ? getComputedStyle(doc) : null;
}

/** The text size in px. */
export function docTextSizeNow(): number {
  const size = parseFloat(docStyle()?.fontSize ?? "");
  return size > 0 ? size : FALLBACK_SIZE;
}

/** The line height as a multiple of the text size. */
export function docLineHeightNow(): number {
  const style = docStyle();
  if (!style) return FALLBACK_LINE_HEIGHT;
  // "normal" is the font's own, near 1.2.
  if (style.lineHeight === "normal") return 1.2;
  const ratio = parseFloat(style.lineHeight) / parseFloat(style.fontSize);
  return ratio > 0 ? ratio : FALLBACK_LINE_HEIGHT;
}

/** The character spacing in points: "normal" is 0. */
export function docLetterSpacingNow(): number {
  const px = parseFloat(docStyle()?.letterSpacing ?? "");
  return Number.isFinite(px) ? px * 0.75 : 0;
}
