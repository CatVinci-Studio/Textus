import { useLayoutEffect, useRef } from "react";
import { frameClock } from "../../engine/frame/clock";
import { BEFORE_ISLANDS } from "../../engine/frame/useIslandFrame";

/**
 * The sidebar opens and closes on the window's clock, with the islands
 * making room beside it (design-language.md 5.7): at its own width
 * throughout, it is revealed by the room the islands leave before them, on
 * their frames - nothing inside it laid out again frame by frame, never
 * showing where an island still is. Off for an iPhone's drawer, which
 * slides on its own (sidebar-frame.css).
 */
export function useSidebarFrame(open: boolean, on: boolean, width: number) {
  const aside = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = aside.current;
    if (!el || !on) return;
    // Its own stylesheet places it; only clipped, to the islands' room
    // before them as it is drawn.
    const box = { x: 0, y: 0, w: el.offsetLeft + width, h: 0 };
    frameClock.attach("sidebar", el);
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
  }, [open, on, width]);
  // Off (an iPhone's drawer) or gone: the clock lets it go.
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
