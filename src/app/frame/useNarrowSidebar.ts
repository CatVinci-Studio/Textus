import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useIslandsNeed } from "../../engine/frame/frame-store";

/**
 * The sidebar steps aside when the window grows too narrow for it and the
 * islands at their least, rather than squeezing them all (VS Code's side
 * bar snaps away the same way), and comes back when there is room again.
 * Only the window narrowing puts it away: opening the AI or a split beside
 * it, or opening it by hand in a narrow window, leaves it where it is.
 */
export function useNarrowSidebar(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
  room: number,
  sidebar: number,
): void {
  const need = useIslandsNeed();
  const fits = room - sidebar >= need;
  const before = useRef({ fits, room });
  const putAway = useRef(false);
  useEffect(() => {
    const was = before.current;
    if (was.fits && !fits && open && room < was.room) {
      putAway.current = true;
      setOpen(false);
    } else if (fits && putAway.current) {
      putAway.current = false;
      if (!open) setOpen(true);
    }
    before.current = { fits, room };
  }, [fits, room, open, setOpen]);
}
