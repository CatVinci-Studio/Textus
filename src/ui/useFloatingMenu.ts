import { useFloatingList } from "./useFloatingList";
import { useMergedRef, usePresence } from "./usePresence";

/** A floating list that stays a moment after it closes, shrinking back into
 *  its trigger: `listRef` goes on the list, `presence` says when to draw it. */
export function useFloatingMenu(
  open: boolean,
  active: number,
  dismiss: () => void,
  maxHeight?: number,
) {
  const floating = useFloatingList(open, active, dismiss, maxHeight);
  const presence = usePresence(open, { exitMs: 120 });
  const listRef = useMergedRef(floating.listRef, presence.ref);
  return { ...floating, list: floating.listRef, listRef, presence };
}
