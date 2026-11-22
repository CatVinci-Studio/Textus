import { useEffect } from "react";
import {
  documentDrop,
  setDocumentDrop,
  type DraggedFile,
} from "../../engine/controls/document-drop";
import { showMessage } from "../../engine/controls/app-dialog";
import { filesDropAsContents, isMobileApp } from "../../platform/capabilities";
import { fill } from "../../i18n/fill";
import type { Strings } from "../../i18n/strings";
import { basename } from "../../utils/path";
import { explainError } from "../../utils/error-explain";
import { watchFilesFromApps } from "../files-from-apps";
import { isFolder } from "../window-file-events";
import type { OpenOptions } from "../useFileOpening";
import { fileDropOnDocuments } from "./file-drop-session";
import { watchSystemDrags } from "./finder-drag";

interface FileDropInput {
  openFile: (path: string) => Promise<void>;
  openPathInTab: (path: string, open?: OpenOptions) => Promise<void>;
  openFolder: (path: string) => void;
  /** The folder open in the sidebar; null with none. */
  folder: string | null;
  t: Strings;
}

/** Opens a dropped file, as File › Open would; what can't be read as text
 *  is a folder, opened in the sidebar, or a file that opens nothing. */
function opener(openFolder: (path: string) => void) {
  return (path: string, open: () => Promise<void>) =>
    open().catch(async () => {
      if (await isFolder(path)) openFolder(path);
    });
}

/**
 * Files dragged over the window - from the sidebar, or from a file
 * manager - put into the document where they are let go, or opened there
 * (file-drop-session.ts).
 */
export function useFileDrops(input: FileDropInput): void {
  const { openFile, openPathInTab, openFolder, folder, t } = input;
  useEffect(() => {
    const opened = opener(openFolder);
    setDocumentDrop(
      fileDropOnDocuments({
        // Only the first from a file manager may take an untouched draft's
        // place, as before.
        open: (path, drop, first, fromSystem) =>
          void opened(path, () =>
            fromSystem && first && drop.zone === "center"
              ? openFile(path)
              : openPathInTab(path, { drop }),
          ),
        openFolder,
        linkRoot: () => folder,
        hints: () => ({
          image: t.fileDropInsertImage,
          link: t.fileDropInsertLink,
        }),
        failed: (path, err) =>
          void showMessage(
            `${fill(t.fileDropFailed, { name: basename(path) })}\n${explainError(err, t)}`,
            { tone: "error" },
          ),
      }),
    );
    if (filesDropAsContents || isMobileApp) return () => setDocumentDrop(null);
    const stop = watchSystemDrags(
      {
        over: (files, at, shift) =>
          documentDrop()?.over(files, at.x, at.y, shift),
        leave: () => documentDrop()?.leave(),
        drop: (files, at, shift) => {
          if (documentDrop()?.drop(files, at.x, at.y, shift)) return;
          // Off the documents (the sidebar, the window's bar): opened.
          files.forEach((file: DraggedFile, i) =>
            file.isDir
              ? openFolder(file.path)
              : void opened(file.path, () =>
                  i === 0 ? openFile(file.path) : openPathInTab(file.path),
                ),
          );
        },
      },
      isFolder,
    );
    return () => {
      stop();
      setDocumentDrop(null);
    };
  }, [openFile, openPathInTab, openFolder, folder, t]);
  useEffect(() => {
    if (filesDropAsContents) return watchFilesFromApps(openPathInTab);
  }, [openPathInTab]);
}
