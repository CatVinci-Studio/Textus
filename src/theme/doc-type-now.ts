/** The document's type as it is drawn now - the theme's, where the reader
 *  set none of their own: where a text stepper starts from. Read on demand
 *  (a render of Settings, a click), never on a hot path. */

/** content-base.css's size at the standard measure, with no document open. */
const FALLBACK_SIZE = 16.5;

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
