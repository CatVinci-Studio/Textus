import { useEffect } from "react";
import {
  listenToThisWebview,
  listenToThisWindow,
  unlistenAll,
} from "../platform/events";
import { fs } from "../platform/ipc";
import { DROP_IMAGE_FILES_EVENT, sendAppEvent } from "../utils/events";
import { openDocument } from "../utils/open-document";
import { filesDropAsContents, isMobileApp } from "../platform/capabilities";
import { isWindowsPlatform } from "../platform/os";
import { dropPointInPage, sortDroppedPaths } from "./dropped-files";
import { watchFilesFromApps } from "./files-from-apps";
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

/**
 * Files dropped on this window from a file manager. Each document gets its
 * own tab, never replacing the one being read; only an untouched Untitled
 * tab gives way. Images go to the editor at the drop point, and a folder
 * opens in the sidebar, as Open Folder does.
 */
export function useFileDrop(
  openFile: (path: string) => Promise<void>,
  openPathInTab: (path: string) => Promise<void>,
  openFolder: (path: string) => void,
): void {
  useEffect(() => {
    if (filesDropAsContents) return watchFilesFromApps(openPathInTab);
    if (isMobileApp) return;
    const unlisten = listenToThisWebview<{
      paths: string[];
      position: { x: number; y: number };
    }>("tauri://drag-drop", async (event) => {
      const { documents, images } = sortDroppedPaths(event.payload.paths);
      if (images.length > 0)
        sendAppEvent(DROP_IMAGE_FILES_EVENT, {
          paths: images,
          point: dropPointInPage(
            event.payload.position,
            isWindowsPlatform(),
            window.devicePixelRatio,
          ),
        });
      // What can't be read as text is a folder, opened in the sidebar, or a
      // file that opens nothing, as in File > Open. Only the first may take
      // an untouched draft's place.
      for (const [i, path] of documents.entries())
        await (i === 0 ? openFile : openPathInTab)(path).catch(async () => {
          if (await isFolder(path)) openFolder(path);
        });
    });
    return unlistenAll(unlisten);
  }, [openFile, openPathInTab, openFolder]);
}

/** Whether `path` is a folder: only a folder lists. */
export function isFolder(path: string): Promise<boolean> {
  return fs.listDir(path).then(
    () => true,
    () => false,
  );
}
