import { useEffect, useLayoutEffect, useRef } from "react";
import { scaledPx } from "../engine/tokens/chrome-scale";
import { onBack } from "./back";
import { OPEN_SETTINGS_PAGE_EVENT } from "../settings/settings-nav";
import { androidBridge } from "../platform/android-bridge";
import { across } from "../utils/gesture";

/** How far a finger moves across before it counts as a swipe, and how near
 *  the left edge one must start to pull the sidebar in. */
const SWIPE = 48;
const EDGE = 24;

/**
 * A phone's sidebar is pushed in from the left (mobile/styles/sidebar.css):
 * a swipe in from the left edge opens it; a tap on the page's strip left
 * showing, a swipe left, Back, another tab coming to the front (a file
 * opened from anywhere) or a Settings page picked pushes it back.
 */
export function usePushedSidebar(
  phone: boolean,
  open: boolean,
  setOpen: (open: boolean) => void,
  activeTabId: string,
): void {
  // Before paint: crossing into a phone's layout never shows it sliding.
  useLayoutEffect(() => {
    if (!phone) return;
    setOpen(false);
  }, [phone, activeTabId, setOpen]);
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
      // A keyboard's click (no press before it) is never the closing tap's.
      if (!swallow || e.detail === 0) return void (swallow = false);
      swallow = false;
      e.preventDefault();
      e.stopPropagation();
    };
    let start: { x: number; y: number } | null = null;
    // A swipe that scrolls something across (a long name, a table, a
    // text field) is that scroll's, not the sidebar's.
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start =
        e.touches.length === 1 && t && !scrollsAcross(e.target)
          ? { x: t.clientX, y: t.clientY }
          : null;
    };
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const dx = start && t ? across(start, t) : null;
      const far = dx !== null && Math.abs(dx) > scaledPx(SWIPE);
      if (far && shown.current && dx < 0) setOpen(false);
      else if (far && !shown.current && dx > 0 && start!.x < scaledPx(EDGE))
        setOpen(true);
      start = null;
    };
    // Android's Back pushes it back first.
    const offBack = onBack(() => {
      if (!shown.current) return false;
      setOpen(false);
      return true;
    });
    // Android keeps its back gesture off the edge the sidebar comes from.
    androidBridge()?.setEdgeSwipe(true);
    // A Settings page picked from it (the same tab): shown, not covered.
    const picked = () => setOpen(false);
    window.addEventListener(OPEN_SETTINGS_PAGE_EVENT, picked);
    window.addEventListener("pointerdown", tap, true);
    window.addEventListener("click", click, true);
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", tap, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchend", up);
      window.removeEventListener(OPEN_SETTINGS_PAGE_EVENT, picked);
      offBack();
      androidBridge()?.setEdgeSwipe(false);
    };
  }, [phone, setOpen]);
}

/** Whether `target` is in something a sideways swipe scrolls or edits. */
function scrollsAcross(target: EventTarget | null): boolean {
  for (
    let el = target instanceof Element ? target : null;
    el && el !== document.body;
    el = el.parentElement
  ) {
    if (el.matches("input, textarea")) return true;
    const { overflowX } = getComputedStyle(el);
    if (/auto|scroll/.test(overflowX) && el.scrollWidth > el.clientWidth + 1)
      return true;
  }
  return false;
}
