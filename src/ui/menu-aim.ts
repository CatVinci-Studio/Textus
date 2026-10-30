import { useEffect, useRef } from "react";

/**
 * Submenus that stay open while the pointer heads for them. A row hovered on
 * the way, inside the triangle from where the pointer was to the submenu's
 * near edge, doesn't swap the submenu: the swap waits until the pointer
 * leaves that triangle, or stops long enough to mean it.
 */

/** A hovered row takes effect after this; with no submenu open, sooner. */
const OPEN_MS = 220;
const FIRST_OPEN_MS = 120;
/** How often a row hovered on the way checks whether the pointer moved on. */
const RECHECK_MS = 80;
/** A pointer resting on the way this long means the row under it. */
const REST_MS = 1200;

type Point = { x: number; y: number };
type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">;

function side(p: Point, a: Point, b: Point): number {
  return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
}

function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = side(p, a, b);
  const d2 = side(p, b, c);
  const d3 = side(p, c, a);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/** Whether a pointer at `now`, having come from `from`, is on its way from
 *  `parent` into `submenu`: inside the triangle to the submenu's near edge,
 *  and within the part of the parent nearest it. */
export function headingFor(
  from: Point,
  now: Point,
  parent: Box,
  submenu: Box,
): boolean {
  const right = submenu.left >= parent.left + parent.width / 2;
  const edge = right ? submenu.left : submenu.right;
  const band = Math.min(90, Math.max(56, parent.width * 0.43));
  const near = right
    ? now.x >= parent.right - band
    : now.x <= parent.left + band;
  return (
    near &&
    inTriangle(
      now,
      from,
      { x: edge, y: submenu.top },
      { x: edge, y: submenu.bottom },
    )
  );
}

/**
 * `hover(next)` for each row the pointer enters (null for a row without a
 * submenu), `move` on the parent menu's pointer moves. `apply` opens `next`.
 * While the pointer heads for the submenu, the parent carries `data-aiming`
 * so the rows it crosses don't light up.
 */
export function useMenuAim<T>(
  apply: (next: T | null) => void,
  parent: () => HTMLElement | null,
  submenu: () => HTMLElement | null,
) {
  const state = useRef({
    points: [] as Point[],
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    since: 0,
  });
  const latest = useRef({ apply, parent, submenu });
  latest.current = { apply, parent, submenu };
  useEffect(() => () => clearTimeout(state.current.timer), []);

  const heading = () => {
    const [from, now] = state.current.points;
    const menu = latest.current.parent();
    const sub = latest.current.submenu();
    return (
      !!from &&
      !!now &&
      !!menu &&
      !!sub &&
      headingFor(
        from,
        now,
        menu.getBoundingClientRect(),
        sub.getBoundingClientRect(),
      )
    );
  };

  return {
    move(e: { clientX: number; clientY: number }) {
      const s = state.current;
      s.points = [...s.points, { x: e.clientX, y: e.clientY }].slice(-2);
      const menu = latest.current.parent();
      if (!menu) return;
      if (heading()) menu.dataset.aiming = "";
      else delete menu.dataset.aiming;
    },
    hover(next: T | null) {
      const s = state.current;
      clearTimeout(s.timer);
      s.since = performance.now();
      const check = () => {
        if (heading() && performance.now() - s.since < REST_MS) {
          s.timer = setTimeout(check, RECHECK_MS);
          return;
        }
        delete latest.current.parent()?.dataset.aiming;
        latest.current.apply(next);
      };
      s.timer = setTimeout(
        check,
        latest.current.submenu() ? OPEN_MS : FIRST_OPEN_MS,
      );
    },
    /** The pointer reached the submenu: whatever was pending is dropped. */
    hold() {
      clearTimeout(state.current.timer);
      delete latest.current.parent()?.dataset.aiming;
    },
  };
}
