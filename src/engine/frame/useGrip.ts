import { useEffect, useRef, useState, type PointerEvent } from "react";
import { holdGrip } from "./grip";

/** How far one arrow key moves a grip, in interface pixels. */
export const GRIP_KEY_STEP = 24;

/** How a hold ended: let go, cancelled by the system, or the grip gone
 *  from the page while held. */
export type GripEnd = "done" | "cancelled" | "gone";

/**
 * A grip held by the pointer (a divider, a panel's edge, a view's corner):
 * the pointer captured, so the hold carries on over the editor and past the
 * window's edge; the window told something is held (grip.ts); let go once
 * however it ends, unmounted included. `start` takes what a move needs
 * (null to ignore the press), `move` follows the pointer, `end` keeps the
 * result.
 */
export function useGrip<S>({
  start,
  move,
  end,
}: {
  start: (event: PointerEvent<HTMLElement>) => S | null;
  move: (event: PointerEvent<HTMLElement>, held: S) => void;
  end: (held: S, how: GripEnd) => void;
}) {
  const held = useRef<S | null>(null);
  const [gripped, setGripped] = useState(false);
  const ended = useRef(end);
  ended.current = end;
  const letGo = (how: GripEnd) => {
    const was = held.current;
    if (was === null) return;
    held.current = null;
    holdGrip(false);
    if (how !== "gone") setGripped(false);
    ended.current(was, how);
  };
  // Gone while held (its island closed, ⌘B mid-drag): let go all the same.
  useEffect(
    () => () => {
      const was = held.current;
      if (was === null) return;
      held.current = null;
      holdGrip(false);
      ended.current(was, "gone");
    },
    [],
  );
  return {
    gripped,
    props: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        const begun = start(event);
        if (begun === null) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        held.current = begun;
        holdGrip(true);
        setGripped(true);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (held.current !== null) move(event, held.current);
      },
      onPointerUp: () => letGo("done"),
      onPointerCancel: () => letGo("cancelled"),
      onLostPointerCapture: () => letGo("done"),
    },
  };
}

/** The way an arrow key moves a grip along `axis`: -1, 1, or 0 for any
 *  other key. */
export function gripKey(key: string, axis: "row" | "column"): -1 | 0 | 1 {
  if (key === (axis === "row" ? "ArrowLeft" : "ArrowUp")) return -1;
  if (key === (axis === "row" ? "ArrowRight" : "ArrowDown")) return 1;
  return 0;
}
