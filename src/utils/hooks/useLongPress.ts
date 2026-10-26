import { useRef, useState } from "react";

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

/**
 * A touch held still on a row, and where. iOS fires no contextmenu for a long
 * press in a web view, so this times it; the click after lifting is swallowed.
 */
export function useLongPress() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    at,
    close: () => setAt(null),
    consumeClick: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        start.current = { x: touch.clientX, y: touch.clientY };
        fired.current = false;
        cancel();
        timer.current = setTimeout(() => {
          fired.current = true;
          setAt(start.current);
        }, LONG_PRESS_MS);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        const from = start.current;
        if (
          from &&
          Math.hypot(touch.clientX - from.x, touch.clientY - from.y) >
            LONG_PRESS_SLOP
        )
          cancel();
      },
      onTouchEnd: cancel,
      onTouchCancel: cancel,
    },
  };
}
