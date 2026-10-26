import { useEffect, type RefObject } from "react";

/** Breathing room kept between the panel's edge and the viewport edge. */
const MARGIN = 12;

/**
 * How much the scroll container has to move for `panel` to be fully visible
 * (positive = down). A panel taller than the viewport shows its bottom, where
 * the composer and the accept/reject bar are.
 */
export function revealOffset(
  panel: { top: number; bottom: number },
  view: { top: number; bottom: number },
  margin = MARGIN,
): number {
  const below = panel.bottom + margin - view.bottom;
  if (below > 0) return below;
  const above = view.top + margin - panel.top;
  if (above > 0) return -above;
  return 0;
}

/**
 * Keeps the Quick Ask panel inside the editor's scroll viewport: on open, and
 * whenever it grows (reply summary, accept/reject bar). After the open, only
 * while part of it is on screen, so it never drags a scrolled-away document
 * back.
 */
export function useQuickAskReveal(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = el.closest<HTMLElement>(".editor-scroll");
    if (!scroller) return;

    const reveal = (force: boolean) => {
      const panel = el.getBoundingClientRect();
      if (panel.height === 0) return; // not laid out (hidden tab)
      const view = scroller.getBoundingClientRect();
      const onScreen = panel.bottom > view.top && panel.top < view.bottom;
      if (!force && !onScreen) return;
      scroller.scrollTop += revealOffset(panel, view);
    };

    reveal(true);
    // Height changes: the reply summary arriving, the pending bar appearing,
    // the composer's textarea auto-growing as the user types.
    const observer = new ResizeObserver(() => reveal(false));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
