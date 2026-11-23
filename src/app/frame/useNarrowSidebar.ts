import {
  useLayoutEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  givingWayNow,
  setSidebarRoom,
  sidebarGaveWay,
  useIslandsNeed,
} from "../../engine/frame/frame-store";

/**
 * The sidebar steps aside when the window grows too narrow for it and the
 * islands at their least, rather than squeezing them all (VS Code's side
 * bar snaps away the same way), and comes back when there is room again.
 * The window narrowing puts it away, and a split made into too little room
 * once its panels have folded; opening the AI beside it, or opening it by
 * hand in a narrow window, leaves it where it is.
 */
export function useNarrowSidebar(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
  room: number,
  sidebar: number,
  /** Panels folded for room come back before it does (useNarrowIslands). */
  wait = false,
): void {
  const need = useIslandsNeed();
  const fits = room - sidebar >= need;
  const before = useRef({ fits, room });
  const putAway = useRef(false);
  // Before paint, or the window shows it squeezed for a frame.
  useLayoutEffect(() => {
    // What putting it aside would give a split (frame-store).
    setSidebarRoom(open && room !== Infinity ? sidebar : 0);
    const was = before.current;
    // A phone's sidebar is pushed in by hand: one put away before the
    // layout turned into the phone's stays shut.
    if (room === Infinity) putAway.current = false;
    const forSplit = givingWayNow() === "sidebar";
    if (forSplit) sidebarGaveWay();
    if (!fits && open && ((was.fits && room < was.room) || forSplit)) {
      putAway.current = true;
      setOpen(false);
    } else if (fits && putAway.current && !wait) {
      putAway.current = false;
      if (!open) setOpen(true);
    }
    before.current = { fits, room };
    // Each fold for a split changes the need: the sidebar's turn is heard.
  }, [fits, need, room, sidebar, open, setOpen, wait]);
}
