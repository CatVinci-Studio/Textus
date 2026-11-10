import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useIslandsNeed } from "../../engine/frame/islands-need";

/**
 * The sidebar steps aside when the window grows too narrow for it and the
 * islands at their least, rather than squeezing them all (VS Code's side
 * bar snaps away the same way), and comes back when there is room again.
 * Only the change closes it: opened by hand in a narrow window, it stays.
 */
export function useNarrowSidebar(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
  room: number,
  sidebar: number,
): void {
  const need = useIslandsNeed();
  const fits = room - sidebar >= need;
  const before = useRef(fits);
  const putAway = useRef(false);
  useEffect(() => {
    if (before.current && !fits && open) {
      putAway.current = true;
      setOpen(false);
    } else if (fits && putAway.current) {
      putAway.current = false;
      if (!open) setOpen(true);
    }
    before.current = fits;
  }, [fits, open, setOpen]);
}
