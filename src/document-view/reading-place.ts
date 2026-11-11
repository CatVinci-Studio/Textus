import type { ScrollPlace } from "../document/last-places";

/**
 * A document's reading place on the page: the block at the scroller's top
 * and how far into it, kept with its caret (last-places.ts) - scrollTop
 * moves with the window's width.
 */
type ReadingPlace = ScrollPlace;

/** The document's blocks, as the editor draws them - not the widgets
 *  between them. */
function blocks(root: Element): HTMLElement[] {
  return [...root.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && !el.classList.contains("ProseMirror-widget"),
  );
}

/** Where `el` starts, in the scroller's content. */
function topIn(scroller: HTMLElement, el: HTMLElement): number {
  return (
    el.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop
  );
}

/** The place `scroller` shows now: its first block not wholly above it. */
export function placeIn(
  scroller: HTMLElement,
  root: Element,
): ReadingPlace | null {
  const list = blocks(root);
  if (list.length === 0) return null;
  const top = scroller.scrollTop;
  const block = list.findIndex(
    (el) => topIn(scroller, el) + el.offsetHeight > top,
  );
  if (block < 0) return null;
  return { block, into: Math.round(top - topIn(scroller, list[block])) };
}

/** Scrolls to `place`, once the document has that many blocks; false
 *  while it hasn't (still being drawn). */
export function scrollToPlace(
  scroller: HTMLElement,
  root: Element,
  place: ReadingPlace,
): boolean {
  const el = blocks(root)[place.block];
  if (!el) return false;
  scroller.scrollTop = topIn(scroller, el) + place.into;
  return true;
}
