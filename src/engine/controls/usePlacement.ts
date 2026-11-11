import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { clampLeft, clampTop, opensBelow } from "./placement";

/**
 * Where a popup at (`x`, `y`) draws, kept inside the window by the same rule
 * every popup follows (placement.ts), and again whenever it grows. `alignEnd`:
 * `x` is its right edge (a menu under a button at a bar's end); `right`: an
 * edge short of the window's it stays left of, read at each placing.
 */
/** `y`, or the top that ends a box `height` tall just over `anchor` when
 *  there is more room above it. */
function above(
  anchor: HTMLElement | null | undefined,
  y: number,
  height: number,
) {
  if (!anchor) return y;
  const box = anchor.getBoundingClientRect();
  const gap = y - box.bottom;
  // Opened at a point inside it (a right-click), not under it.
  if (gap < 0) return y;
  return opensBelow(box, height, gap) ? y : box.top - gap - height;
}

export function usePlacement(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  options: {
    right?: () => number | undefined;
    alignEnd?: boolean;
    /** What opened it: it opens above that, where there's more room. */
    anchor?: () => HTMLElement | null | undefined;
  } = {},
): { left: number; top: number } {
  const { alignEnd = false } = options;
  const rightRef = useRef(options.right);
  rightRef.current = options.right;
  const anchorRef = useRef(options.anchor);
  anchorRef.current = options.anchor;
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      // Layout size, not the on-screen box: an entrance scaling up from 96%
      // would be measured short and placed over the edge.
      const width = el.offsetWidth || el.getBoundingClientRect().width;
      const height = el.offsetHeight || el.getBoundingClientRect().height;
      setPos({
        left: clampLeft(
          alignEnd ? x - width : x,
          width,
          undefined,
          rightRef.current?.() ?? window.innerWidth,
        ),
        top: clampTop(above(anchorRef.current?.(), y, height), height),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, x, y, alignEnd]);
  return pos;
}
