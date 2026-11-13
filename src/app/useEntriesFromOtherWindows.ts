import { useEffect } from "react";
import { listenToThisWindow, unlistenAll } from "../platform/events";
import { readBoot } from "../storage/boot";
import { useLatest } from "../utils/hooks/useLatest";
import { ENTRY_TRASHED_EVENT, FILE_WRITTEN_EVENT } from "../utils/events";

/** What another window did to the folder (tree_ops.rs). */
interface EntriesChanged {
  from: string;
  moved: [string, string] | null;
  trashed: string | null;
}

/**
 * A move, rename or trash made in another window: this window's tree reads
 * the folders again, and its tabs follow the move or let the file go, as
 * they do for one made here.
 */
export function useEntriesFromOtherWindows(
  follow: (from: string, to: string) => void,
): void {
  const latest = useLatest(follow);
  useEffect(() => {
    const told = (name: string, path: string) =>
      window.dispatchEvent(new CustomEvent(name, { detail: path }));
    return unlistenAll(
      listenToThisWindow<EntriesChanged>("entries-changed", (event) => {
        const { from, moved, trashed } = event.payload;
        if (from === readBoot()?.label) return;
        if (moved) {
          latest.current(moved[0], moved[1]);
          for (const path of moved) told(FILE_WRITTEN_EVENT, path);
        }
        if (trashed) {
          told(ENTRY_TRASHED_EVENT, trashed);
          told(FILE_WRITTEN_EVENT, trashed);
        }
      }),
    );
  }, [latest]);
}
