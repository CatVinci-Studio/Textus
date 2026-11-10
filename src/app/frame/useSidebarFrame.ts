import { useLayoutEffect, useRef } from "react";
import { frameClock } from "../../engine/frame/clock";

/**
 * The sidebar opens and closes on the window's clock, with the islands
 * making room beside it (design-language.md 5.7): its column grows from
 * nothing to its width and the sidebar, at its own width throughout, is
 * revealed by it - nothing inside it laid out again frame by frame. Off
 * for an iPhone's drawer, which slides on its own (sidebar-frame.css).
 */
export function useSidebarFrame(open: boolean, on: boolean) {
  const aside = useRef<HTMLElement | null>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = aside.current;
    if (!el || !on) return;
    const box = {
      x: el.offsetLeft,
      y: el.offsetTop,
      w: el.offsetWidth,
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
      placed.current,
    );
    placed.current = true;
  }, [open, on]);
  return aside;
}
