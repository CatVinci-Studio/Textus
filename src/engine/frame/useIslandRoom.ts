import { useLayoutEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

/** The islands' area as laid out: its size, where it sits in the shell,
 *  and the layout's spacings in pixels. */
export interface IslandRoom {
  w: number;
  h: number;
  origin: { x: number; y: number };
  inset: number;
  gap: number;
  /** A row of tabs: the window bar's height. */
  bar: number;
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
  a.gap === b.gap &&
  a.bar === b.bar &&
  a.shellAt.x === b.shellAt.x &&
  a.shellAt.y === b.shellAt.y;

/**
 * Measured when the area changes size (a sidebar opened, the window
 * resized: drawn in the same frame, before it is painted) and when `key`
 * - what else moves it, the layout's switches - changes. Never on every
 * render: a keystroke would lay the page out again. The spacing tokens are
 * read off a hidden probe, which resolves their calc()s.
 */
export function useIslandRoom(
  area: RefObject<HTMLElement | null>,
  probe: RefObject<HTMLElement | null>,
  key: string,
): IslandRoom | null {
  const [room, setRoom] = useState<IslandRoom | null>(null);
  useLayoutEffect(() => {
    const next = measure(area.current, probe.current);
    if (next) setRoom((was) => (same(was, next) ? was : next));
  }, [area, probe, key]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const next = measure(area.current, probe.current);
      if (next)
        flushSync(() => setRoom((was) => (same(was, next) ? was : next)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [area, probe]);
  return room;
}

function measure(
  el: HTMLElement | null,
  probe: HTMLElement | null,
): IslandRoom | null {
  if (!el || !probe) return null;
  const shell = el.offsetParent as HTMLElement | null;
  const style = getComputedStyle(probe);
  const at = shell?.getBoundingClientRect();
  return {
    w: el.clientWidth,
    h: el.clientHeight,
    origin: { x: el.offsetLeft, y: el.offsetTop },
    inset: parseFloat(style.width) || 0,
    gap: parseFloat(style.marginLeft) || 0,
    bar: parseFloat(style.height) || 0,
    shell: { w: shell?.clientWidth ?? 0, h: shell?.clientHeight ?? 0 },
    shellAt: { x: at?.left ?? 0, y: at?.top ?? 0 },
  };
}
