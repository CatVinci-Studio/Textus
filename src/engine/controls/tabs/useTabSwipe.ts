import { useEffect, useRef, type RefObject } from "react";
import { canHaptic, isMobileApp } from "../../../platform/capabilities";
import { iosFiles } from "../../../platform/ios-files";
import { across, claimSwipe, TOUCH_SLOP_PX } from "../../../utils/gesture";
import { scaledPx } from "../../tokens/chrome-scale";

/** How far a finger moves along the row to count as a swipe. */
const SWIPE_PX = 40;

/**
 * On a phone or tablet, whose row may show only a tab or two, a sideways
 * swipe along the row brings the tab beside the open one to the front:
 * left the next, right the one before, as Safari's address bar does. A
 * lifted tab's drag is left alone.
 */
export function useTabSwipe(
  bar: RefObject<HTMLElement | null>,
  ids: readonly string[],
  activeTabId: string,
  onActivate: (id: string) => void,
): void {
  const now = useRef({ ids, activeTabId, onActivate });
  now.current = { ids, activeTabId, onActivate };
  useEffect(() => {
    // The whole row: a swipe may start between its buttons.
    const el = bar.current?.closest<HTMLElement>(".island-row") ?? bar.current;
    if (!el || !isMobileApp) return;
    let start: { x: number; y: number } | null = null;
    const along = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      return start && t ? across(start, t) : null;
    };
    // Taken on the window: on a phone the window bar's empty middle lies
    // over the row, and a swipe may start there.
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      const row = el.getBoundingClientRect();
      start =
        e.touches.length === 1 &&
        t &&
        t.clientY >= row.top &&
        t.clientY <= row.bottom &&
        t.clientX >= row.left &&
        t.clientX <= row.right
          ? { x: t.clientX, y: t.clientY }
          : null;
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      if (el.querySelector(".tab-pill-lifted")) start = null;
      const dx = along(e);
      // The row's own scroll and the sidebar's swipe stay out of it.
      if (dx !== null && Math.abs(dx) > scaledPx(TOUCH_SLOP_PX)) {
        e.preventDefault();
        claimSwipe();
      }
    };
    const up = (e: TouchEvent) => {
      const dx = along(e);
      start = null;
      if (dx === null || Math.abs(dx) < scaledPx(SWIPE_PX)) return;
      const { ids, activeTabId, onActivate } = now.current;
      const next = ids[ids.indexOf(activeTabId) + (dx < 0 ? 1 : -1)];
      if (next === undefined) return;
      e.stopPropagation();
      onActivate(next);
      if (canHaptic) iosFiles.haptic();
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [bar]);
}
