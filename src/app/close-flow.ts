import { useCallback, useEffect } from "react";
import { thisWindow } from "../platform/this-window";
import { canUseWindows } from "../platform/capabilities";
import { unlistenAll } from "../platform/events";
import { tabIsDirty, type DocTab } from "../document/doc-tabs";
import { drafts, session } from "../platform/ipc";
import { flushPendingWrites } from "../storage/pending-writes";
import { useModalDialog } from "../ui/useModalDialog";
import { useLatest } from "../utils/hooks/useLatest";
import type { TabState } from "./tabs/useTabState";

// What the save/discard/cancel prompt is guarding: a tab, the whole window,
// or replacing a tab's document in place.
export type PendingClose =
  | { kind: "tab"; tabId: string }
  | { kind: "window" }
  | { kind: "replace"; tabId: string; path: string };

/** Removes tabs outright, or behind the prompt when autosave couldn't
 *  write their changes. */
export function useTabRemoval(opts: {
  tabState: TabState;
  cancelDraftFlushes: () => void;
  flushAutosave: (ids?: string[]) => Promise<void>;
  setPendingClose: (close: PendingClose) => void;
}) {
  const { tabState, cancelDraftFlushes, flushAutosave, setPendingClose } = opts;
  const { tabsRef, setTabs, setActiveTabId, liveTabs } = tabState;

  // No prompt here. Closing the last tab closes the window; the active tab
  // hands focus to its right-hand neighbor.
  const removeTab = useCallback(
    (id: string) => {
      const closedIndex = tabsRef.current.findIndex((tb) => tb.id === id);
      setTabs((prev) => {
        const next = prev.filter((tb) => tb.id !== id);
        if (next.length === 0) {
          // No window to close on iOS: the last tab simply stays.
          if (!canUseWindows) return prev;
          // Destroying the window skips the draft cleanup effect, so clear
          // the snapshot here or a discarded tab returns as a draft.
          cancelDraftFlushes();
          void Promise.allSettled([
            drafts.clearDraftSnapshot(id),
            flushPendingWrites(),
          ]).then(() => void thisWindow().destroy());
          return prev;
        }
        return next;
      });
      setActiveTabId((prevActive) => {
        if (prevActive !== id) return prevActive;
        const remaining = tabsRef.current.filter((tb) => tb.id !== id);
        if (remaining.length === 0) return prevActive;
        return remaining[Math.min(closedIndex, remaining.length - 1)].id;
      });
    },
    [cancelDraftFlushes, tabsRef, setTabs, setActiveTabId],
  );

  const requestCloseTab = useCallback(
    async (id: string) => {
      await flushAutosave([id]);
      const tab = liveTabs().find((tb) => tb.id === id);
      if (!tab || !tabIsDirty(tab)) {
        removeTab(id);
        return;
      }
      setPendingClose({ kind: "tab", tabId: id });
    },
    [flushAutosave, removeTab, liveTabs, setPendingClose],
  );

  return { removeTab, requestCloseTab };
}

/**
 * Every window close lands here: unsaved tabs get the prompt, or with
 * `keepUnsaved` are kept as drafts. Tauri destroys the window once this
 * resolves, so pending storage writes are flushed first.
 */
export function useWindowCloseGuard(
  liveTabs: () => DocTab[],
  flushAutosave: () => Promise<void>,
  setPendingClose: (close: PendingClose) => void,
  keepUnsaved: boolean,
): void {
  const keep = useLatest(keepUnsaved);
  useEffect(() => {
    const unlisten = thisWindow().onCloseRequested(async (event) => {
      await flushAutosave();
      const dirty = liveTabs().filter(tabIsDirty);
      if (dirty.length > 0 && keep.current) {
        await Promise.all(
          dirty.map((tab) =>
            drafts.saveDraftSnapshot(tab.id, tab.path, tab.content),
          ),
        );
      } else if (dirty.length > 0) {
        event.preventDefault();
        setPendingClose({ kind: "window" });
        return;
      }
      await flushPendingWrites();
    });
    return unlistenAll(unlisten);
  }, [liveTabs, flushAutosave, setPendingClose, keep]);
}

/** The prompt's three answers - Save, Don't Save, Cancel - carried out for
 *  whichever close is pending, and the modal wiring of its dialog. */
export function useClosePrompt(opts: {
  pendingClose: PendingClose | null;
  setPendingClose: (close: PendingClose | null) => void;
  tabState: TabState;
  cancelDraftFlushes: () => void;
  saveTab: (tabId: string) => Promise<boolean>;
  removeTab: (tabId: string) => void;
  replaceTabWithFile: (tabId: string, path: string) => Promise<void>;
}) {
  const {
    pendingClose,
    setPendingClose,
    tabState,
    cancelDraftFlushes,
    saveTab,
    removeTab,
    replaceTabWithFile,
  } = opts;
  const { tabsRef, liveTabs } = tabState;

  /** Deletes this window's draft snapshots before destroy(), which skips the
   *  usual cleanup effect. Per tab: other windows share the draft store. */
  const clearWindowDrafts = useCallback(async () => {
    // A debounce firing before destroy() would re-save a cleared snapshot.
    cancelDraftFlushes();
    await Promise.all(
      tabsRef.current.map((tab) => drafts.clearDraftSnapshot(tab.id)),
    );
  }, [cancelDraftFlushes, tabsRef]);

  const closeSaving = useCallback(async () => {
    const action = pendingClose;
    setPendingClose(null);
    if (!action) return;
    if (action.kind === "window") {
      // A cancelled Save As leaves the window open.
      for (const tab of liveTabs()) {
        if (!tabIsDirty(tab)) continue;
        const ok = await saveTab(tab.id);
        if (!ok) {
          await session.cancelQuit();
          return;
        }
      }
      await clearWindowDrafts();
      await flushPendingWrites();
      await thisWindow().destroy();
    } else if (action.kind === "tab") {
      if (!(await saveTab(action.tabId))) return;
      removeTab(action.tabId);
    } else {
      if (!(await saveTab(action.tabId))) return;
      await replaceTabWithFile(action.tabId, action.path);
    }
  }, [
    pendingClose,
    setPendingClose,
    saveTab,
    removeTab,
    replaceTabWithFile,
    clearWindowDrafts,
    liveTabs,
  ]);

  const closeDiscarding = useCallback(async () => {
    const action = pendingClose;
    setPendingClose(null);
    if (!action) return;
    if (action.kind === "window") {
      await clearWindowDrafts();
      await flushPendingWrites();
      await thisWindow().destroy();
    } else if (action.kind === "tab") removeTab(action.tabId);
    else await replaceTabWithFile(action.tabId, action.path);
  }, [
    pendingClose,
    setPendingClose,
    removeTab,
    replaceTabWithFile,
    clearWindowDrafts,
  ]);

  const cancelClose = () => {
    setPendingClose(null);
    void session.cancelQuit();
  };
  const closePrompt = useModalDialog(
    cancelClose,
    pendingClose !== null,
    ".close-prompt-primary",
  );

  return { closeSaving, closeDiscarding, cancelClose, closePrompt };
}
