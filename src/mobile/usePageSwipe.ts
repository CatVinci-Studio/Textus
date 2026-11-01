import { useEffect, useRef } from "react";

/** How far in from the screen's side a swipe between the pages starts:
 *  further in, a finger is selecting text or scrolling a table. */
const EDGE = 28;
/** The least travel, in px, that turns the page. */
const TRAVEL = 60;

/** Whether a finger from `start` to `end` turns the page: from the
 *  screen's right edge leftwards to Textus AI, and from the AI panel's left
 *  edge (`panelLeft`: the screen's on a phone) rightwards back. */
export function swipeTurnsPage(
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  ai: boolean,
  panelLeft = 0,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < TRAVEL || Math.abs(dx) < Math.abs(dy) * 2) return false;
  return ai
    ? Math.abs(start.x - panelLeft) <= EDGE && dx > 0
    : start.x >= width - EDGE && dx < 0;
}

/** Edge swipes between the document and Textus AI: the phone's two pages,
 *  or an iPad's docked panel. `enabled` false while there is no AI to show. */
export function usePageSwipe(enabled: boolean, ai: boolean, turn: () => void) {
  const state = useRef({ ai, turn });
  state.current = { ai, turn };
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      // Only on the pages themselves, not a dialog or menu over them.
      const onPage =
        e.target instanceof Element &&
        e.target.closest(".main-pane, .agent-panel") !== null;
      start =
        e.touches.length === 1 && onPage
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    };
    const onEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!start || !touch) return;
      const end = { x: touch.clientX, y: touch.clientY };
      const panel = document.querySelector(".agent-panel");
      const panelLeft = panel?.getBoundingClientRect().left ?? 0;
      if (
        swipeTurnsPage(
          start,
          end,
          window.innerWidth,
          state.current.ai,
          panelLeft,
        )
      )
        state.current.turn();
      start = null;
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [enabled]);
}
