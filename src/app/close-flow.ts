import { useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { canUseWindows } from "../platform/capabilities";
import { unlistenAll } from "../utils/tauri-events";
import { tabIsDirty, type DocTab } from "../document/doc-tabs";
import { drafts, session } from "../platform/ipc";
import { flushPendingWrites } from "../storage/pending-writes";
import { useModalDialog } from "../ui/useModalDialog";
import { useLatest } from "../utils/hooks/useLatest";
import type { TabState } from "./useTabState";

// The one save/discard/cancel prompt, reused for every "this would lose
// unsaved content" moment: closing a tab, closing the whole window (every
// dirty tab needs a decision, not just the active one), or replacing the
// active tab's document in place (window-mode Open File / agent.md).
export type PendingClose =
  | { kind: "tab"; tabId: string }
  | { kind: "window" }
  | { kind: "replace"; tabId: string; path: string };

/** Taking tabs away: outright (removeTab) or behind the prompt when the
 *  tab has unsaved changes (requestCloseTab) - which, with Save
 *  Automatically on, are written first, so only what that couldn't save
 *  (a new document, a conflict, a failed write) still asks. */
export function useTabRemoval(opts: {
  tabState: TabState;
  cancelDraftFlushes: () => void;
  flushAutosave: (ids?: string[]) => Promise<void>;
  setPendingClose: (close: PendingClose) => void;
}) {
  const { tabState, cancelDraftFlushes, flushAutosave, setPendingClose } = opts;
  const { tabsRef, setTabs, setActiveTabId, liveTabs } = tabState;

  // Removes a tab outright (no prompt - callers that need one show it
  // first). Closing the last tab closes the window; closing the active tab
  // hands focus to its right-hand neighbor, or the new last tab.
  const removeTab = useCallback(
    (id: string) => {
      const closedIndex = tabsRef.current.findIndex((tb) => tb.id === id);
      setTabs((prev) => {
        const next = prev.filter((tb) => tb.id !== id);
        if (next.length === 0) {
          // No window to close on iOS: the last tab simply stays.
          if (!canUseWindows) return prev;
          // Closing the last tab destroys the window, so useDraftAutosave's
          // cleanup effect (which clears a departed tab's snapshot) never gets
          // another run - without the explicit clear here, a dirty tab closed
          // via "Don't Save" comes back as a recovered draft on next launch.
          // Storage writes still on their way go first, like every close.
          cancelDraftFlushes();
          void Promise.allSettled([
            drafts.clearDraftSnapshot(id),
            flushPendingWrites(),
          ]).then(() => void getCurrentWindow().destroy());
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
 * Closing with unsaved changes swaps the native close for the
 * save/discard/cancel prompt, scoped to the whole window (every dirty tab
 * needs a decision, not just the active one). Registered once; reads
 * dirtiness through liveTabs so the listener doesn't churn on every
 * keystroke, and so an edit typed just before closing still counts.
 * Every way of closing a window lands here - its close button, File >
 * Close Window, Quit (Cmd+Q closes each window in turn), Alt+F4 - and the
 * Tauri API destroys the window once this handler resolves, unless it
 * prevented the close. So with nothing to ask, it first waits for the
 * storage writes still on their way to Rust (a setting typed a moment
 * ago) or held back (the resting zoom); the prompt's Save / Don't Save do the same before they
 * destroy the window themselves.
 *
 * With `keepUnsaved` (Settings › Privacy › Keep unsaved changes when
 * closing) there is nothing to ask: each unsaved tab is kept as a draft
 * now, and the next launch opens it again with its changes, as it does
 * after a crash (startup-restore.ts).
 */
export function useWindowCloseGuard(
  liveTabs: () => DocTab[],
  flushAutosave: () => Promise<void>,
  setPendingClose: (close: PendingClose) => void,
  keepUnsaved: boolean,
): void {
  const keep = useLatest(keepUnsaved);
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      // Save Automatically writes what it can first; the prompt is for the
      // rest.
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

  /** Deletes this window's draft snapshots before the window is destroyed.
   *  Draft cleanup normally rides useDraftAutosave's next effect run (a tab
   *  leaves `tabs`, or turns clean) - but destroy() means there IS no next
   *  run, so a whole-window close must clean up explicitly or the discarded
   *  content comes back as a "restored draft" on the next launch. Per-tab
   *  rather than clearAllDrafts: the draft store is shared by every window,
   *  and other windows' drafts must survive. */
  const clearWindowDrafts = useCallback(async () => {
    // Scheduled flushes first: a debounce timer firing between the clears
    // below and destroy() would re-save a snapshot that was just deleted.
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
      // Whole window: save every dirty tab, aborting (leaving the window
      // open) if any of them hits a cancelled Save As.
      for (const tab of liveTabs()) {
        if (!tabIsDirty(tab)) continue;
        const ok = await saveTab(tab.id);
        if (!ok) {
          await session.cancelQuit();
          return;
        }
      }
      // The just-saved tabs' snapshot cleanup would race destroy() below
      // (it runs on a later effect tick) - do it synchronously instead.
      await clearWindowDrafts();
      await flushPendingWrites();
      await getCurrentWindow().destroy();
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
      // "Don't Save" is a decision - the discarded content must not come
      // back as a recovered draft on the next launch.
      await clearWindowDrafts();
      await flushPendingWrites();
      await getCurrentWindow().destroy();
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
  // A real modal like the app's other dialogs: Escape cancels, and Tab
  // can't wander into the editor behind it and start typing there.
  const closePrompt = useModalDialog(
    cancelClose,
    pendingClose !== null,
    ".close-prompt-primary",
  );

  return { closeSaving, closeDiscarding, cancelClose, closePrompt };
}
