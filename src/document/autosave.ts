import { useCallback, useEffect, useRef, useState } from "react";
import { thisWindow } from "../platform/this-window";
import { tabIsDirty, type DocTab } from "./doc-tabs";
import { createTabIdleTimers } from "./tab-idle-timers";
import { unlistenAll } from "../platform/events";

/** What one save of a tab came to. "conflict": the user kept the changed
 *  disk version; "failed": the user was told why. */
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

/** A pause ends once the tab has been saved, reloaded or saved elsewhere. */
function pauseResolved(tab: DocTab, pause: AutosavePause): boolean {
  return (
    tab.path !== pause.path ||
    tab.savedContent !== pause.savedContent ||
    tab.diskMtime !== pause.diskMtime
  );
}

/** Whether autosave writes a tab: it has a file, has changed, and isn't
 *  paused. Untitled documents are left to draft recovery. */
export function autosaveWants(
  tab: DocTab,
  pause: AutosavePause | undefined,
): boolean {
  if (!tab.path || !tabIsDirty(tab)) return false;
  return !pause || pauseResolved(tab, pause);
}

/**
 * Save Automatically: writes a file-backed document after typing rests, on
 * blur, hide or tab switch. A conflict Cancel or failed write pauses the tab,
 * so the prompt shows once. `flush(ids?)` writes now; closing waits on it.
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

  const [timers] = useState(() =>
    createTabIdleTimers<string>({
      idleMs: AUTOSAVE_IDLE_MS,
      same: (a, b) => a === b,
    }),
  );
  const paused = useRef(new Map<string, AutosavePause>());
  // One autosave per tab at a time, so one queued behind a prompt sees its pause.
  const chains = useRef(new Map<string, Promise<void>>());

  const saveNow = useCallback(
    (id: string): Promise<void> => {
      timers.cancel(id);
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
    [timers],
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
    for (const id of timers.ids()) if (!seen.has(id)) timers.cancel(id);
    for (const [id, pause] of [...paused.current]) {
      const tab = tabs.find((tb) => tb.id === id);
      if (!tab || pauseResolved(tab, pause)) paused.current.delete(id);
    }
    if (!enabled) {
      timers.cancelAll();
      return;
    }
    for (const tab of tabs) {
      if (autosaveWants(tab, paused.current.get(tab.id)))
        timers.schedule(tab.id, tab.content, () => void saveNow(tab.id));
      else timers.cancel(tab.id);
    }
  }, [tabs, enabled, timers, saveNow]);

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
    const unlisten = thisWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) void flush();
    });
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      unlistenAll(unlisten)();
    };
  }, [flush]);

  useEffect(() => timers.cancelAll, [timers]);

  return flush;
}
