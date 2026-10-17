import { useCallback, useEffect } from "react";
import { listenToThisWindow, unlistenAll } from "../utils/tauri-events";
import {
  makeBlankTab,
  readDocFromDisk,
  tabIsDirty,
  type DocTab,
} from "../document/doc-tabs";
import { fs, session } from "../platform/ipc";
import { useWindowEvent } from "../utils/hooks/useWindowEvent";
import {
  DROP_IMAGE_FILES_EVENT,
  OPEN_FILE_IN_TAB_EVENT,
} from "../utils/events";
import { isIOSApp } from "../platform/capabilities";
import { isWindowsPlatform } from "../platform/os";
import { dropPointInPage, sortDroppedPaths } from "./dropped-files";
import type { NewDocumentMode } from "../settings/SettingsContext";
import type { PendingClose } from "./close-flow";
import type { TabState } from "./useTabState";

/**
 * Every way a file on disk becomes an open document in this window: a new
 * tab, or (window mode) the active tab's document replaced in place -
 * behind the save/discard prompt when that would lose unsaved edits.
 */
export function useFileOpening(opts: {
  tabState: TabState;
  newDocumentMode: NewDocumentMode;
  setPendingClose: (close: PendingClose) => void;
  /** File > Open's file-type names besides Markdown, in the UI language. */
  dialogFilters: { textFilter: string; allFilter: string };
}) {
  const { tabState, newDocumentMode, setPendingClose, dialogFilters } = opts;
  const { tabsRef, setTabs, activeTabId, setActiveTabId, updateTab } = tabState;

  const openPathInTab = useCallback(
    async (path: string) => {
      const existing = tabsRef.current.find((tab) => tab.path === path);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      const { content: text, diskMtime } = await readDocFromDisk(path);
      void session.addRecentFile(path); // feeds File > Open Recent
      const newTab: DocTab = {
        ...makeBlankTab(),
        path,
        content: text,
        savedContent: text,
        diskMtime,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    },
    [tabsRef, setTabs, setActiveTabId],
  );

  // "window" mode's actual replace step, shared between the no-dirty fast
  // path and the save/discard prompt's resolution (2.3: unsaved protection).
  const replaceTabWithFile = useCallback(
    async (tabId: string, path: string) => {
      const { content: text, diskMtime } = await readDocFromDisk(path);
      void session.addRecentFile(path);
      const reloadKey =
        (tabsRef.current.find((tb) => tb.id === tabId)?.reloadKey ?? 0) + 1;
      updateTab(tabId, {
        path,
        content: text,
        savedContent: text,
        diskMtime,
        reloadKey,
      });
    },
    [tabsRef, updateTab],
  );

  const openFile = useCallback(
    async (path: string) => {
      if (newDocumentMode === "tab") {
        await openPathInTab(path);
        return;
      }
      // "window" mode: replace the active tab's document in place, same as
      // this app has always worked for a single document per window - unless
      // that would silently lose unsaved edits, in which case the same
      // save/discard/cancel prompt used for closing steps in first.
      const activeTab = tabsRef.current.find((tb) => tb.id === activeTabId);
      if (activeTab && tabIsDirty(activeTab)) {
        setPendingClose({ kind: "replace", tabId: activeTabId, path });
        return;
      }
      await replaceTabWithFile(activeTabId, path);
    },
    [
      newDocumentMode,
      activeTabId,
      openPathInTab,
      replaceTabWithFile,
      tabsRef,
      setPendingClose,
    ],
  );

  // The Agent panel's project bar opens the style profile and library
  // entries beside the document being written - always a new tab, never
  // replacing that document (window mode would otherwise swap it out).
  useWindowEvent(OPEN_FILE_IN_TAB_EVENT, (e) => {
    const path = (e as CustomEvent<string>).detail;
    if (typeof path === "string" && path) void openPathInTab(path);
  });

  const openFileDialog = useCallback(async () => {
    const picked = await fs.openFileDialog(dialogFilters);
    if (picked) await openFile(picked);
  }, [openFile, dialogFilters]);

  return { openPathInTab, replaceTabWithFile, openFile, openFileDialog };
}

/**
 * Runtime counterpart to the mount-time drain (useStartupRestore): Finder
 * "Open With"/the CLI on an already-running instance, while in "tab" mode,
 * arrives as a push instead (see lib.rs's queue_paths_to_open). Strictly
 * this window: Rust addresses exactly one window, and a catch-all listener
 * would open the file in every open window (see listenToThisWindow).
 */
export function useOpenPathsPush(
  openPathInTab: (path: string) => Promise<void>,
): void {
  useEffect(() => {
    const unlisten = listenToThisWindow<string[]>(
      "open-paths-as-tabs",
      async (event) => {
        for (const p of event.payload) await openPathInTab(p);
      },
    );
    return unlistenAll(unlisten);
  }, [openPathInTab]);
}

/**
 * Files dropped on this window from a file manager (dropped-files.ts).
 * Strictly this window, like the push above: Tauri addresses the drop to
 * the window it landed on. One document opens the way File > Open does
 * (a tab, or in window mode in place of this one); several each get a tab
 * here, rather than replacing one another in turn. Dropped images go to
 * the editor on screen, at the drop point (images/image-plugin.ts).
 */
export function useFileDrop(
  openFile: (path: string) => Promise<void>,
  openPathInTab: (path: string) => Promise<void>,
): void {
  useEffect(() => {
    if (isIOSApp) return;
    const unlisten = listenToThisWindow<{
      paths: string[];
      position: { x: number; y: number };
    }>("tauri://drag-drop", async (event) => {
      const { documents, images } = sortDroppedPaths(event.payload.paths);
      if (images.length > 0)
        window.dispatchEvent(
          new CustomEvent(DROP_IMAGE_FILES_EVENT, {
            detail: {
              paths: images,
              point: dropPointInPage(
                event.payload.position,
                isWindowsPlatform(),
                window.devicePixelRatio,
              ),
            },
          }),
        );
      // A file that can't be read as text (a folder, a binary) opens
      // nothing, the same as when it is picked in File > Open.
      const open = documents.length === 1 ? openFile : openPathInTab;
      for (const path of documents) await open(path).catch(() => undefined);
    });
    return unlistenAll(unlisten);
  }, [openFile, openPathInTab]);
}
