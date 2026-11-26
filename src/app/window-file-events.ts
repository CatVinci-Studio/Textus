import { useEffect } from "react";
import { listenToThisWindow, unlistenAll } from "../platform/events";
import { fs } from "../platform/ipc";
import { openDocument } from "../utils/open-document";
import type { OpenOptions } from "./useFileOpening";

/**
 * OS opens on an already-running instance in tab mode, pushed to exactly
 * this window; a catch-all listener would open it in every window.
 */
export function useOpenPathsPush(
  openPathInTab: (path: string, open?: OpenOptions) => Promise<void>,
): void {
  useEffect(() => {
    const unlisten = listenToThisWindow<string[]>(
      "open-paths-as-tabs",
      async (event) => {
        // Open Recent from a non-empty window arrives this way too. In
        // order: the last one in front.
        for (const p of event.payload)
          await openDocument(p, { restoreCaret: true });
      },
    );
    return unlistenAll(unlisten);
  }, [openPathInTab]);
}

/** Whether `path` is a folder: only a folder lists. */
export function isFolder(path: string): Promise<boolean> {
  return fs.listDir(path).then(
    () => true,
    () => false,
  );
}
