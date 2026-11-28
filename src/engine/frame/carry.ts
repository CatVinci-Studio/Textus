/**
 * A view's column held where the reader saw it as the view takes its new
 * width. The clock lays a view out at its end size on a motion's first
 * frame; a column centred in it (a document's text, a settings page) would
 * re-centre there at once - half the sidebar's width away - and only then
 * ride with the island. So the column's place in its view is read once
 * before the change and once after, and the gap between them is carried
 * by the element marked `data-frame-carry` (the view's scroller, so the
 * caret, sticky headers and the margin go with it), easing out on the
 * island's own curve: from where it was to where it ends, never back.
 *
 * Inside a carrier, `data-frame-column` marks the column whose start is
 * held (its content box: where the text begins).
 */

export interface Carried {
  el: HTMLElement;
  /** Px it is held off its end place at the motion's start. */
  by: number;
}

const CARRIER = "[data-frame-carry]";
const COLUMN = "[data-frame-column]";

/** Where each carrier's column starts, in from `view`'s left edge as it
 *  is drawn now (a carry already under way included). One layout read. */
export function columnStarts(view: HTMLElement): Map<HTMLElement, number> {
  const starts = new Map<HTMLElement, number>();
  const carriers = view.querySelectorAll<HTMLElement>(CARRIER);
  if (!carriers.length) return starts;
  const origin = view.getBoundingClientRect().left;
  for (const el of carriers) {
    const column = el.querySelector<HTMLElement>(COLUMN);
    if (!column) continue;
    const box = column.getBoundingClientRect();
    // Hidden (a mode not shown): nothing seen to hold.
    if (!box.width) continue;
    const pad = parseFloat(getComputedStyle(column).paddingLeft) || 0;
    starts.set(el, box.left + column.clientLeft + pad - origin);
  }
  return starts;
}

/** What each carrier holds: how far its column was from where the end
 *  layout puts it. Under half a pixel is nothing to carry. */
export function carriedBy(
  before: Map<HTMLElement, number>,
  after: Map<HTMLElement, number>,
): Carried[] {
  const carried: Carried[] = [];
  for (const [el, was] of before) {
    const now = after.get(el);
    if (now === undefined) continue;
    const by = was - now;
    if (Math.abs(by) >= 0.5) carried.push({ el, by });
  }
  return carried;
}
