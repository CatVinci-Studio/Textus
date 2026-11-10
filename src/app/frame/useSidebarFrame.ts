import { useLayoutEffect, useRef } from "react";
import { frameClock } from "../../engine/frame/clock";

/**
 * The sidebar opens and closes on the window's clock, with the islands
 * making room beside it (design-language.md 5.7): its column grows from
 * nothing to its width and the sidebar, at its own width throughout, is
 * revealed by it - nothing inside it laid out again frame by frame. Off
 * for an iPhone's drawer, which slides on its own (sidebar-frame.css).
 */
export function useSidebarFrame(open: boolean, on: boolean, width: number) {
  const aside = useRef<HTMLElement | null>(null);
  /** Open or not when last placed; none before the first time. */
  const was = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const el = aside.current;
    if (!el || !on) return;
    // Its width is the one its edge's drag set (--sidebar-width): the
    // column takes each new one at once, so a widened sidebar shows whole.
    const box = {
      x: el.offsetLeft,
      y: el.offsetTop,
      w: width,
      h: el.offsetHeight,
    };
    frameClock.attach("sidebar", el);
    frameClock.set(
      "sidebar",
      new Map([
        ["sidebar-column", { rect: { ...box, w: open ? box.w : 0 } }],
        [
          "sidebar",
          { rect: box, follow: "sidebar-column", still: true, own: true },
        ],
      ]),
      { x: 0, y: 0 },
      was.current !== null && was.current !== open,
    );
    was.current = open;
  }, [open, on, width]);
  return aside;
}
