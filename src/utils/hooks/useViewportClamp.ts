import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface ViewportClampOptions {
  margin?: number;
  /** "down" (default): top pinned at `y`, grows downward. "up": bottom pinned
   *  near `y` on first render, grows upward, so an input row stays put while
   *  messages pile up above it. */
  grow?: "down" | "up";
  /** A right edge short of the window's (the editor beside the AI panel),
   *  read at each clamp. */
  right?: () => number | undefined;
}

/**
 * Keeps a fixed-position popup inside the viewport: give it the anchor point
 * you want and it returns where to render. Re-clamps whenever the element
 * resizes, since popups grow.
 */
export function useViewportClamp(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  options: ViewportClampOptions = {},
): { left: number; top: number } {
  const { margin = 8, grow = "down", right } = options;
  const rightRef = useRef(right);
  rightRef.current = right;
  const [pos, setPos] = useState({ left: x, top: y });
  // With grow === "up": the bottom edge later growth pivots around, set on the
  // first clamp of a given (x, y).
  const bottomAnchor = useRef<number | null>(null);

  useLayoutEffect(() => {
    bottomAnchor.current = null;
  }, [x, y]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const clamp = () => {
      // Layout size, not the on-screen box: an entrance scaling up from 96% would
      // be measured short and placed over the edge.
      const rect = el.getBoundingClientRect();
      const width = el.offsetWidth || rect.width;
      const height = el.offsetHeight || rect.height;
      const desiredTop =
        grow === "up" && bottomAnchor.current !== null
          ? bottomAnchor.current - height
          : y;
      const top = Math.max(
        margin,
        Math.min(desiredTop, window.innerHeight - height - margin),
      );
      if (grow === "up" && bottomAnchor.current === null)
        bottomAnchor.current = top + height;
      setPos({
        left: Math.max(
          margin,
          Math.min(
            x,
            (rightRef.current?.() ?? window.innerWidth) - width - margin,
          ),
        ),
        top,
      });
    };

    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, x, y, margin, grow]);

  return pos;
}
