import { useEffect } from "react";
import { listenToThisWindow, unlistenAll } from "../platform/events";
import { readBoot } from "../storage/boot";
import { useLatest } from "../utils/hooks/useLatest";
import {
  ENTRY_TRASHED_EVENT,
  FILE_WRITTEN_EVENT,
  sendAppEvent,
} from "../utils/events";

/** What another window did to the folder: `EntriesChanged` in
 *  src-tauri/src/commands/tree_ops.rs. */
interface EntriesChanged {
  from: string;
  moved: [string, string] | null;
  trashed: string | null;
  /** Put back from the Trash. */
  restored: string | null;
}

/**
 * A move, rename, trash or put back made in another window: this window's tree reads
 * the folders again, and its tabs follow the move or let the file go, as
 * they do for one made here.
 */
export function useEntriesFromOtherWindows(
  follow: (from: string, to: string) => void,
): void {
  const latest = useLatest(follow);
  useEffect(() => {
    return unlistenAll(
      listenToThisWindow<EntriesChanged>("entries-changed", (event) => {
        const { from, moved, trashed, restored } = event.payload;
        if (from === readBoot()?.label) return;
        if (moved) {
          latest.current(moved[0], moved[1]);
          for (const path of moved) sendAppEvent(FILE_WRITTEN_EVENT, path);
        }
        if (trashed) {
          sendAppEvent(ENTRY_TRASHED_EVENT, trashed);
          sendAppEvent(FILE_WRITTEN_EVENT, trashed);
        }
        if (restored) sendAppEvent(FILE_WRITTEN_EVENT, restored);
      }),
    );
  }, [latest]);
}
