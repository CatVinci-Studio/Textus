import { useSyncExternalStore } from "react";
import { createSubscribers } from "../../../utils/store";

/** A file dragged over the documents that will open as a tab of island
 *  `pane`: its room in that row, at `x` (its centre, in the viewport), as
 *  a tab from another window gets one. */
export interface IncomingTab {
  pane: string;
  title: string;
  x: number;
}

let current: IncomingTab | null = null;
const heard = createSubscribers();

export function setIncomingTab(next: IncomingTab | null): void {
  if (
    current === next ||
    (current &&
      next &&
      current.pane === next.pane &&
      current.title === next.title &&
      current.x === next.x)
  )
    return;
  current = next;
  heard.publish();
}

/** The tab coming into a row, if any. */
export function useIncomingTab(): IncomingTab | null {
  return useSyncExternalStore(heard.subscribe, () => current);
}
