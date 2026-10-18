import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { tabIsDirty, type DocTab } from "./doc-tabs";
import { unlistenAll } from "../utils/tauri-events";

/** What one save of a tab came to (app/useSaveTabs.ts's autosaveTab).
 *  "skipped": nothing to write - no file, or no change. "conflict": the file
 *  changed on disk and the user kept that version. "failed": the write
 *  failed and the user was told why. */
export type SaveOutcome = "saved" | "skipped" | "conflict" | "failed";

/** How long typing has to rest before a document is written back. */
export const AUTOSAVE_IDLE_MS = 2000;

/** A tab autosave stopped writing, and the state it stopped at. */
interface AutosavePause {
  path: string | null;
  savedContent: string;
  diskMtime: number | null;
}

function pauseOf(tab: DocTab): AutosavePause {
  return {
    path: tab.path,
    savedContent: tab.savedContent,
    diskMtime: tab.diskMtime,
  };
}

/** A pause ends once the tab has been saved, reloaded or saved elsewhere
 *  some other way - the user dealt with what stopped it. */
function pauseResolved(tab: DocTab, pause: AutosavePause): boolean {
  return (
    tab.path !== pause.path ||
    tab.savedContent !== pause.savedContent ||
    tab.diskMtime !== pause.diskMtime
  );
}

/** Whether a tab is one autosave writes: it has a file, it has changed,
 *  and autosave hasn't stopped on it. Untitled documents (and the Help
 *  guides, which have no file either) are left to draft recovery. */
export function autosaveWants(
  tab: DocTab,
  pause: AutosavePause | undefined,
): boolean {
  if (!tab.path || !tabIsDirty(tab)) return false;
  return !pause || pauseResolved(tab, pause);
}

/**
 * Settings › General › Save Automatically (#133): a document that already
 * has a file is written back to it once typing has rested for
 * AUTOSAVE_IDLE_MS, and right away when the window loses focus, the page is
 * hidden, or another tab is chosen. Off by default; draft recovery
 * (draft-autosave.ts) keeps covering untitled documents either way.
 *
 * Every write is File > Save's own (`autosaveTab`), so the conflict check,
 * the line endings and the saved state are the same. When the file changed
 * on disk, that save asks before overwriting; a Cancel there, or a write
 * that failed (a read-only file), pauses autosave for the tab, so the
 * prompt or the error is shown once rather than every two seconds. The
 * pause ends when the tab is saved, reloaded or saved elsewhere some other
 * way (pauseResolved).
 *
 * Returns `flush(ids?)`: writes the given tabs (every tab by default) now,
 * resolving once done - what closing a tab or the window waits for before
 * deciding whether anything is still unsaved. A no-op while off.
 */
export function useAutosave(opts: {
  tabs: DocTab[];
  activeTabId: string;
  enabled: boolean;
  autosaveTab: (tabId: string) => Promise<SaveOutcome>;
}): (ids?: string[]) => Promise<void> {
  const { tabs, activeTabId, enabled, autosaveTab } = opts;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const saveRef = useRef(autosaveTab);
  saveRef.current = autosaveTab;

  const timers = useRef(new Map<string, { content: string; timer: number }>());
  const paused = useRef(new Map<string, AutosavePause>());
  // Each tab's saves one after another: a second one waiting behind a
  // conflict prompt must see the pause the first one's Cancel left.
  const chains = useRef(new Map<string, Promise<void>>());

  const clearTimer = useCallback((id: string) => {
    const pending = timers.current.get(id);
    if (pending) clearTimeout(pending.timer);
    timers.current.delete(id);
  }, []);

  const saveNow = useCallback(
    (id: string): Promise<void> => {
      clearTimer(id);
      const attempt = async () => {
        if (!enabledRef.current || paused.current.has(id)) return;
        const tab = tabsRef.current.find((tb) => tb.id === id);
        // Not checked for dirtiness here: the editor may still hold an edit
        // it hasn't reported, which autosaveTab pulls in before judging.
        if (!tab?.path) return;
        const outcome = await saveRef.current(id);
        if (outcome === "conflict" || outcome === "failed") {
          const now = tabsRef.current.find((tb) => tb.id === id) ?? tab;
          paused.current.set(id, pauseOf(now));
        }
      };
      const next = (chains.current.get(id) ?? Promise.resolve())
        .then(attempt)
        .catch((err: unknown) => console.error("[autosave]", err));
      chains.current.set(id, next);
      void next.then(() => {
        if (chains.current.get(id) === next) chains.current.delete(id);
      });
      return next;
    },
    [clearTimer],
  );

  const flush = useCallback(
    async (ids?: string[]): Promise<void> => {
      if (!enabledRef.current) return;
      const targets = ids ?? tabsRef.current.map((tb) => tb.id);
      await Promise.all(targets.map((id) => saveNow(id)));
    },
    [saveNow],
  );

  useEffect(() => {
    const seen = new Set(tabs.map((tb) => tb.id));
    for (const id of [...timers.current.keys()])
      if (!seen.has(id)) clearTimer(id);
    for (const [id, pause] of [...paused.current]) {
      const tab = tabs.find((tb) => tb.id === id);
      if (!tab || pauseResolved(tab, pause)) paused.current.delete(id);
    }
    if (!enabled) {
      for (const id of [...timers.current.keys()]) clearTimer(id);
      return;
    }
    for (const tab of tabs) {
      if (!autosaveWants(tab, paused.current.get(tab.id))) {
        clearTimer(tab.id);
        continue;
      }
      const pending = timers.current.get(tab.id);
      if (pending?.content === tab.content) continue;
      clearTimer(tab.id);
      const timer = window.setTimeout(
        () => void saveNow(tab.id),
        AUTOSAVE_IDLE_MS,
      );
      timers.current.set(tab.id, { content: tab.content, timer });
    }
  }, [tabs, enabled, clearTimer, saveNow]);

  // Choosing another tab writes the one left behind.
  const previousActive = useRef(activeTabId);
  useEffect(() => {
    const left = previousActive.current;
    previousActive.current = activeTabId;
    if (left !== activeTabId) void flush([left]);
  }, [activeTabId, flush]);

  // Leaving the window (another app, another Textus window) or hiding the
  // page (minimised; on iOS, going to the background) writes everything.
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(
      ({ payload: focused }) => {
        if (!focused) void flush();
      },
    );
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      unlistenAll(unlisten)();
    };
  }, [flush]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const { timer } of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return flush;
}
