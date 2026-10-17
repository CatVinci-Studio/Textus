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
import { OPEN_FILE_IN_TAB_EVENT } from "../utils/events";
import type { NewDocumentMode } from "../settings/SettingsContext";
import type { PendingClose } from "./close-flow";
import type { TabState } from "./useTabState";
import { confirmWorkspaceClose } from "../document/workspace-close";
import { flushPendingWrites } from "../storage/pending-writes";

/**
 * Every way a file on disk becomes an open document in this window: a new
 * tab, or (window mode) the active tab's document replaced in place -
 * behind the save/discard prompt when that would lose unsaved edits.
 */
export function useFileOpening(opts: {
  tabState: TabState;
  newDocumentMode: NewDocumentMode;
  setPendingClose: (close: PendingClose) => void;
}) {
  const { tabState, newDocumentMode, setPendingClose } = opts;
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
      const previous = tabsRef.current.find((tab) => tab.id === tabId);
      if (previous?.path === path) return;
      const { content: text, diskMtime } = await readDocFromDisk(path);
      if (!(await confirmWorkspaceClose([tabId]))) return;
      await flushPendingWrites();
      void session.addRecentFile(path);
      const reloadKey =
        (tabsRef.current.find((tb) => tb.id === tabId)?.reloadKey ?? 0) + 1;
      updateTab(tabId, {
        workspaceId: crypto.randomUUID(),
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
    const picked = await fs.openFileDialog();
    if (picked) await openFile(picked);
  }, [openFile]);

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
