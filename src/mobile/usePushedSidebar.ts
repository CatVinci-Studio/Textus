import { useEffect, useRef } from "react";
import { scaledPx } from "../engine/tokens/chrome-scale";

/** How far a finger moves across before it counts as a swipe, and how near
 *  the left edge one must start to pull the sidebar in. */
const SWIPE = 48;
const EDGE = 24;

/**
 * A phone's sidebar is pushed in from the left (mobile/styles/sidebar.css):
 * a swipe in from the left edge opens it; a tap on the page's strip left
 * showing, or a swipe left, pushes it back.
 */
export function usePushedSidebar(
  phone: boolean,
  open: boolean,
  setOpen: (open: boolean) => void,
): void {
  // Read as events come: the listeners stay put while it opens and closes,
  // so the closing tap's click still finds them.
  const shown = useRef(open);
  shown.current = open;
  useEffect(() => {
    if (!phone) return;
    const onPage = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest(".main-pane, .window-bar") &&
      !target.closest(".window-bar-sidebar-toggle");
    // The tap that closes does only that: its click goes nowhere.
    let swallow = false;
    const tap = (e: PointerEvent) => {
      swallow = shown.current && onPage(e.target);
      if (!swallow) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    const click = (e: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      e.preventDefault();
      e.stopPropagation();
    };
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start =
        e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    };
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const across =
        Math.abs(dx) > SWIPE &&
        Math.abs(dx) > 2 * Math.abs(t.clientY - start.y);
      if (across && shown.current && dx < 0) setOpen(false);
      else if (across && !shown.current && dx > 0 && start.x < scaledPx(EDGE))
        setOpen(true);
      start = null;
    };
    window.addEventListener("pointerdown", tap, true);
    window.addEventListener("click", click, true);
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", tap, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchend", up);
    };
  }, [phone, setOpen]);
}
