import { useLayoutEffect, useRef } from "react";
import { frameClock } from "../../engine/frame/clock";
import { BEFORE_ISLANDS } from "../../engine/frame/useIslandFrame";

/**
 * The sidebar opens and closes on the window's clock, with the islands
 * making room beside it (design-language.md 5.7): at its own width
 * throughout, it is revealed by the room the islands leave before them, on
 * their frames - nothing inside it laid out again frame by frame, never
 * showing where an island still is. Off on a phone, where the page is
 * pushed aside instead (mobile/styles/sidebar.css).
 */
export function useSidebarFrame(open: boolean, on: boolean, width: number) {
  const aside = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = aside.current;
    if (!el || !on) return;
    frameClock.attach("sidebar", el);
    placeSidebar(el, width);
  }, [open, on, width]);
  // Off (a phone) or gone: the clock lets it go.
  useLayoutEffect(() => {
    if (on) return;
    frameClock.drop("sidebar");
    frameClock.attach("sidebar", null);
  }, [on]);
  useLayoutEffect(
    () => () => {
      frameClock.drop("sidebar");
      frameClock.attach("sidebar", null);
    },
    [],
  );
  return aside;
}

/** The sidebar at `width` on the clock: its own stylesheet places it; it is
 *  only clipped, to the islands' room before them as it is drawn. Also as
 *  its edge is held, at the width held. */
export function placeSidebar(el: HTMLElement, width: number): void {
  const box = { x: 0, y: 0, w: el.offsetLeft + width, h: 0 };
  frameClock.set(
    "sidebar",
    new Map([
      [
        "sidebar",
        { rect: box, follow: BEFORE_ISLANDS, still: true, own: true },
      ],
    ]),
    { x: 0, y: 0 },
    false,
  );
}
