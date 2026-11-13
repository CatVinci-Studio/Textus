import { useLayoutEffect, useRef } from "react";
import { scaledPx } from "../../engine/tokens/chrome-scale";
import { frameClock } from "../../engine/frame/clock";
import { useFrameLayout } from "../../engine/frame/frame-store";
import { useBarObstacles } from "../../engine/layout/row-insets";

/** Room kept between the title and what sits beside it. */
const GAP = 14;
/** Less than this either side of the column's centre, and the title moves. */
const MIN_HALF = 88;

/**
 * The window bar's title over the document it names: centred on its
 * island as the solver places it, as wide as twice the room from there to
 * the controls either side (a long name cut short), else the free stretch
 * between them; moved on the window's clock with the islands. `on` false
 * leaves it to its stylesheet (the menu bar's row, a phone's).
 */
export function useTitleRoom(on: boolean) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const bar = useBarObstacles();
  const { islands } = useFrameLayout();
  const island = islands[0];
  const across = island && { x: island.whole.x, w: island.whole.w };
  const width = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    if (!on || !bar || !across) {
      frameClock.drop("title");
      frameClock.attach("title", null);
      el.style.left = "";
      el.style.width = "";
      return;
    }
    const gap = scaledPx(GAP);
    const centre = across.x + across.w / 2;
    const start = Math.max(bar.left, bar.leadEnd) + gap;
    const end =
      Math.min(bar.right, ...bar.ends.filter((e) => e > centre)) - gap;
    const half = Math.min(centre - start, end - centre);
    const rect =
      half >= scaledPx(MIN_HALF)
        ? { x: centre - half, w: 2 * half }
        : { x: start, w: Math.max(0, end - start) };
    frameClock.attach("title", el);
    // A window resized moves it at once, as the islands.
    const resized = width.current !== null && width.current !== bar.right;
    width.current = bar.right;
    frameClock.set(
      "title",
      new Map([["title", { rect: { ...rect, y: 0, h: 0 }, along: true }]]),
      { x: bar.left, y: 0 },
      !resized,
    );
    // Its island's span, not the object made again each solve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, bar, across?.x, across?.w]);
  useLayoutEffect(() => () => frameClock.drop("title"), []);
  return titleRef;
}
