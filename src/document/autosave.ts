import { useCallback, useEffect, useRef, useState } from "react";
import { thisWindow } from "../platform/this-window";
import { tabIsDirty, type DocTab } from "./doc-tabs";
import { createTabIdleTimers } from "./tab-idle-timers";
import { unlistenAll } from "../platform/events";
import { titleSettled, untitledAutosavable } from "./autosave-untitled";

/** What one save of a tab came to. "conflict": the user kept the changed
 *  disk version; "failed": the user was told why. */
export type SaveOutcome = "saved" | "skipped" | "conflict" | "failed";

/** How long typing has to rest before a document is written back. */
export const AUTOSAVE_IDLE_MS = 2000;

/** How long an untitled draft rests, its first line alone, before it gets a
 *  file anyway: the line may be a title still being typed. */
export const UNTITLED_IDLE_MS = 30000;

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

/** What becomes of untitled drafts: with a folder open (`toFile`) they get
 *  a file there, except the tour's practice tab. */
interface DraftRule {
  toFile: boolean;
  practiceTabId: string | null;
}

const KEEP_DRAFTS: DraftRule = { toFile: false, practiceTabId: null };

/** Whether autosave may write a tab at all: one with a file, or an untitled
 *  draft with something in it, which gets a file of its own. */
function autosaveCovers(tab: DocTab, drafts: DraftRule): boolean {
  if (tab.path) return true;
  return (
    drafts.toFile && tab.id !== drafts.practiceTabId && untitledAutosavable(tab)
  );
}

/** Whether autosave writes a tab: it is covered, has changed, and isn't
 *  paused. */
export function autosaveWants(
  tab: DocTab,
  pause: AutosavePause | undefined,
  drafts: DraftRule = KEEP_DRAFTS,
): boolean {
  if (!autosaveCovers(tab, drafts) || !tabIsDirty(tab)) return false;
  return !pause || pauseResolved(tab, pause);
}

/** The idle timers that start an autosave: one for documents, a slower
 *  one for untitled drafts whose title is still being written. */
function useIdleTimers() {
  const [timers] = useState(() =>
    createTabIdleTimers<string>({
      idleMs: AUTOSAVE_IDLE_MS,
      same: (a, b) => a === b,
    }),
  );
  const [untitledTimers] = useState(() =>
    createTabIdleTimers<string>({
      idleMs: UNTITLED_IDLE_MS,
      same: (a, b) => a === b,
    }),
  );
  return { timers, untitledTimers };
}

/** Choosing another tab writes the one left behind; leaving the window
 *  (another app, another Textus window) or hiding the page (minimised; on
 *  iOS, going to the background) writes everything. */
function useFlushOnLeave(
  activeTabId: string,
  flush: (ids?: string[]) => Promise<void>,
) {
  const previousActive = useRef(activeTabId);
  useEffect(() => {
    const left = previousActive.current;
    previousActive.current = activeTabId;
    if (left !== activeTabId) void flush([left]);
  }, [activeTabId, flush]);

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
}

/**
 * Save Automatically: writes a document after typing rests, on blur, hide or
 * tab switch; with a folder open, an untitled one into a file of its own
 * there, once its title is written. A conflict Cancel or failed write pauses the tab, so the prompt
 * shows once. `flush(ids?)` writes now; closing waits on it.
 */
export function useAutosave(opts: {
  tabs: DocTab[];
  /** The window's tabs as they are now, not as of the last render: a save
   *  that just gave a draft its path is seen by the next autosave. */
  tabsRef: { readonly current: readonly DocTab[] };
  activeTabId: string;
  enabled: boolean;
  /** A folder is open, so untitled drafts get files in it. */
  untitledToFile?: boolean;
  /** The onboarding tour's practice tab, never written to a file. */
  practiceTabId?: string | null;
  autosaveTab: (tabId: string) => Promise<SaveOutcome>;
}): (ids?: string[]) => Promise<void> {
  const { tabs, tabsRef, activeTabId, enabled, autosaveTab } = opts;
  const untitledToFile = opts.untitledToFile ?? false;
  const practiceTabId = opts.practiceTabId ?? null;
  // As of this render, for the saves under way.
  const now = useRef<{
    drafts: DraftRule;
    enabled: boolean;
    save: typeof autosaveTab;
  }>({
    drafts: KEEP_DRAFTS,
    enabled,
    save: autosaveTab,
  });
  now.current = {
    drafts: { toFile: untitledToFile, practiceTabId },
    enabled,
    save: autosaveTab,
  };

  const { timers, untitledTimers } = useIdleTimers();
  // Tabs paused by a conflict or failure, and one autosave per tab at a
  // time, so one queued behind a prompt sees its pause.
  const kept = useRef({
    paused: new Map<string, AutosavePause>(),
    chains: new Map<string, Promise<void>>(),
  });

  const saveNow = useCallback(
    (id: string): Promise<void> => {
      timers.cancel(id);
      untitledTimers.cancel(id);
      const attempt = async () => {
        if (!now.current.enabled || kept.current.paused.has(id)) return;
        const tab = tabsRef.current.find((tb) => tb.id === id);
        // Not checked for dirtiness here: the editor may still hold an edit
        // it hasn't reported, which autosaveTab pulls in before judging.
        // Nor for text: autosaveTab judges an untitled draft once pulled in.
        const drafts = now.current.drafts;
        if (
          !tab ||
          (!tab.path && (!drafts.toFile || tab.id === drafts.practiceTabId))
        )
          return;
        const outcome = await now.current.save(id);
        if (outcome === "conflict" || outcome === "failed") {
          const now = tabsRef.current.find((tb) => tb.id === id) ?? tab;
          kept.current.paused.set(id, pauseOf(now));
        }
      };
      const next = (kept.current.chains.get(id) ?? Promise.resolve())
        .then(attempt)
        .catch((err: unknown) => console.error("[autosave]", err));
      kept.current.chains.set(id, next);
      void next.then(() => {
        if (kept.current.chains.get(id) === next)
          kept.current.chains.delete(id);
      });
      return next;
    },
    [timers, untitledTimers, tabsRef],
  );

  const flush = useCallback(
    async (ids?: string[]): Promise<void> => {
      if (!now.current.enabled) return;
      const targets = ids ?? tabsRef.current.map((tb) => tb.id);
      await Promise.all(targets.map((id) => saveNow(id)));
    },
    [saveNow, tabsRef],
  );

  useEffect(() => {
    const seen = new Set(tabs.map((tb) => tb.id));
    for (const id of [...timers.ids(), ...untitledTimers.ids()])
      if (!seen.has(id)) {
        timers.cancel(id);
        untitledTimers.cancel(id);
      }
    for (const [id, pause] of [...kept.current.paused]) {
      const tab = tabs.find((tb) => tb.id === id);
      if (!tab || pauseResolved(tab, pause)) kept.current.paused.delete(id);
    }
    if (!enabled) {
      timers.cancelAll();
      untitledTimers.cancelAll();
      return;
    }
    const drafts = { toFile: untitledToFile, practiceTabId };
    for (const tab of tabs) {
      const wants = autosaveWants(tab, kept.current.paused.get(tab.id), drafts);
      const slow = wants && !tab.path && !titleSettled(tab.content);
      const [use, other] = slow
        ? [untitledTimers, timers]
        : [timers, untitledTimers];
      other.cancel(tab.id);
      if (wants) use.schedule(tab.id, tab.content, () => void saveNow(tab.id));
      else use.cancel(tab.id);
    }
  }, [
    tabs,
    enabled,
    untitledToFile,
    practiceTabId,
    timers,
    untitledTimers,
    saveNow,
  ]);

  useFlushOnLeave(activeTabId, flush);

  useEffect(
    () => () => {
      timers.cancelAll();
      untitledTimers.cancelAll();
    },
    [timers, untitledTimers, tabsRef],
  );

  return flush;
}
