import { tokenPx } from "../tokens/token-px";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { isMobileApp } from "../../platform/capabilities";
import { onAppearance } from "../tokens/appearance";

/** The islands' area as laid out: its size, where it sits in the shell,
 *  and the layout's spacings in pixels. */
export interface IslandRoom {
  w: number;
  h: number;
  origin: { x: number; y: number };
  inset: number;
  /** Under the islands: the inset, or none where they run to the foot. */
  foot: number;
  gap: number;
  /** A row of tabs: the window bar's height. */
  bar: number;
  /** An inner island's row: the bar's, without the status bar's room. */
  row: number;
  /** The shell's own size: when it changed, the window was resized. */
  shell: { w: number; h: number };
  /** Where the shell sits in the viewport. */
  shellAt: { x: number; y: number };
}

const same = (a: IslandRoom | null, b: IslandRoom) =>
  !!a &&
  a.w === b.w &&
  a.h === b.h &&
  a.origin.x === b.origin.x &&
  a.origin.y === b.origin.y &&
  a.inset === b.inset &&
  a.foot === b.foot &&
  a.gap === b.gap &&
  a.bar === b.bar &&
  a.row === b.row &&
  a.shellAt.x === b.shellAt.x &&
  a.shellAt.y === b.shellAt.y;

/**
 * Measured when the area changes size (a sidebar opened, the window
 * resized: drawn in the same frame, before it is painted) and when `key`
 * - what else moves it, the layout's switches - changes. Never on every
 * render: a keystroke would lay the page out again. The spacing tokens are
 * read off a hidden probe, which resolves their calc()s: afresh when the
 * look or the layout's switches change, kept as the area only resizes -
 * each fresh read is a style and layout pass of its own, five per
 * measure, on every frame of a sidebar's edge dragged.
 */
export function useIslandRoom(
  area: RefObject<HTMLElement | null>,
  key: string,
): IslandRoom | null {
  const [room, setRoom] = useState<IslandRoom | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  useLayoutEffect(() => {
    const el = area.current;
    const next = measure(el, true);
    if (next) setRoom((was) => (same(was, next) ? was : next));
    // Observed afresh, it reports its size next frame: a size read
    // mid-change (a sidebar narrowed and widened again before the frame)
    // is corrected even when the frame ends at the size it had before.
    if (el && observer.current) {
      observer.current.unobserve(el);
      observer.current.observe(el);
    }
  }, [area, key]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measured = (fresh: boolean) => () => {
      const next = measure(area.current, fresh);
      if (next)
        flushSync(() => setRoom((was) => (same(was, next) ? was : next)));
    };
    // Resized: the spacings are as they were.
    const watch = new ResizeObserver(measured(false));
    // Anything else read again (the look, a phone's bars and keyboard).
    const remeasure = measured(true);
    watch.observe(el);
    observer.current = watch;
    // The spacings change with the look (Layout, Interface Size) too, with
    // the area's size often staying the same.
    const restyled = onAppearance(remeasure);
    // A phone's also once the window's resize is told: keyboard-up, marked
    // then, may change the spacings after the size is seen. The app's own
    // word on its bars and keyboard comes with no resize at all: read once
    // those have been applied.
    const later = () => requestAnimationFrame(remeasure);
    const told = ["textus-insets", "textus-keyboard"];
    if (isMobileApp) {
      window.addEventListener("resize", remeasure);
      for (const type of told) window.addEventListener(type, later);
    }
    return () => {
      watch.disconnect();
      restyled();
      observer.current = null;
      window.removeEventListener("resize", remeasure);
      for (const type of told) window.removeEventListener(type, later);
    };
  }, [area]);
  return room;
}

function measure(el: HTMLElement | null, again: boolean): IslandRoom | null {
  if (!el) return null;
  const shell = el.offsetParent as HTMLElement | null;
  const at = shell?.getBoundingClientRect();
  // Read again when asked: a Layout or text size switch may not be told
  // yet.
  const fresh = { fresh: again };
  return {
    w: el.clientWidth,
    h: el.clientHeight,
    origin: { x: el.offsetLeft, y: el.offsetTop },
    inset: tokenPx("--island-inset", fresh),
    foot: tokenPx("--island-foot", fresh),
    gap: tokenPx("--island-gap", fresh),
    bar: tokenPx("--window-bar-height", fresh),
    row: tokenPx("--window-bar-row", fresh),
    shell: { w: shell?.clientWidth ?? 0, h: shell?.clientHeight ?? 0 },
    shellAt: { x: at?.left ?? 0, y: at?.top ?? 0 },
  };
}
