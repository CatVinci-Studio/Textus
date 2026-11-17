import { basename, parentDir } from "../utils/path";
import { fileExists, tabIsDirty, type DocTab } from "../document/doc-tabs";
import {
  freeFilePath,
  untitledAutosavable,
} from "../document/autosave-untitled";
import type { SaveOutcome } from "../document/autosave";
import { fs, session } from "../platform/ipc";
import { notePathMoved } from "../plugins/app-bridge";
import type { TabState } from "./tabs/useTabState";

import { useCallback, useMemo, useRef } from "react";

/** The save queue untitled drafts' first autosaves share. */
const UNTITLED_QUEUE = "\0untitled";

/** Files autosave named itself, by tab: they follow the title until the
 *  user names them (Save As, or a rename that moves the tab elsewhere). */
export function useAutoNamed() {
  const named = useRef(new Map<string, string>());
  return useMemo(
    () => ({
      get: (tabId: string) => named.current.get(tabId),
      set: (tabId: string, path: string) => named.current.set(tabId, path),
      forget: (tabId: string) => named.current.delete(tabId),
    }),
    [],
  );
}
type AutoNamed = ReturnType<typeof useAutoNamed>;

/** One save per tab at a time: a racing save would see our own write as
 *  external. */
export function useOneSavePerTab() {
  const queues = useRef(new Map<string, Promise<unknown>>());
  const serialized = useCallback(
    <T>(tabId: string, run: () => Promise<T>): Promise<T> => {
      const next = (queues.current.get(tabId) ?? Promise.resolve()).then(
        run,
        run,
      );
      const settled = next.catch(() => undefined);
      queues.current.set(tabId, settled);
      void settled.then(() => {
        if (queues.current.get(tabId) === settled) queues.current.delete(tabId);
      });
      return next;
    },
    [],
  );

  return serialized;
}
export type Serialized = ReturnType<typeof useOneSavePerTab>;

/** Autosave: File > Save for a changed document that has a file, never a
 *  Save As; an untitled draft with text gets a file without a dialog, in
 *  the window's folder, and follows its title until the user names it. */
export function useAutosaveTab({
  tabState,
  folder,
  suggestedName,
  adoptFile,
  saveToPath,
  serialized,
  autoNamed,
}: {
  tabState: TabState;
  folder: string | null;
  suggestedName: (tab: DocTab) => string;
  adoptFile: (tab: DocTab, picked: string, auto: boolean) => Promise<boolean>;
  saveToPath: (tabId: string, auto: boolean) => Promise<SaveOutcome>;
  serialized: Serialized;
  autoNamed: AutoNamed;
}) {
  const { liveTabs, updateTab } = tabState;
  // An untitled draft's first autosave: into the window's open folder,
  // named as Save As would suggest and numbered rather than overwriting. One
  // at a time across tabs, so two drafts of the same name can't both take
  // it. With no folder open it stays a draft.
  const autosaveUntitled = useCallback(
    (tab: DocTab): Promise<SaveOutcome> =>
      serialized(UNTITLED_QUEUE, async () => {
        if (!folder) return "skipped";
        const path = await freeFilePath(folder, suggestedName(tab), fileExists);
        if (!path) return "skipped";
        if (!(await adoptFile(tab, path, true))) return "failed";
        autoNamed.set(tab.id, path);
        return "saved";
      }),
    [serialized, folder, suggestedName, adoptFile, autoNamed],
  );

  // A file autosave named: renamed after the title as it changes. Anything
  // in the way (a rename refused, the name taken) leaves it where it is.
  const followTitle = useCallback(
    async (tabId: string) => {
      const tab = liveTabs().find((tb) => tb.id === tabId);
      const from = tab?.path;
      const dir = from && parentDir(from);
      if (!tab || !from || !dir || autoNamed.get(tabId) !== from) {
        autoNamed.forget(tabId);
        return;
      }
      const wanted = suggestedName(tab);
      if (wanted === basename(from)) return;
      // Its own file is no obstacle, in any case (macOS ignores it).
      const to = await freeFilePath(
        dir,
        wanted,
        async (p) =>
          p.toLowerCase() !== from.toLowerCase() && (await fileExists(p)),
      );
      if (!to || to === from) return;
      let moved: string;
      try {
        moved = await fs.renameEntry(from, basename(to));
      } catch {
        autoNamed.forget(tabId);
        return;
      }
      autoNamed.set(tabId, moved);
      updateTab(tabId, { path: moved });
      void notePathMoved(from, moved);
      void session.addRecentFile(moved);
    },
    [liveTabs, updateTab, suggestedName, autoNamed],
  );

  /** Autosave: File > Save for a changed document that has a file, never a
   *  Save As; an untitled draft with text gets a file without a dialog.
   *  Conflicts and failures prompt as a manual save does. */
  const autosaveTab = useCallback(
    (tabId: string): Promise<SaveOutcome> =>
      serialized(tabId, async () => {
        const tab = liveTabs().find((tb) => tb.id === tabId);
        if (!tab || !tabIsDirty(tab)) return "skipped";
        if (!tab.path)
          return untitledAutosavable(tab) ? autosaveUntitled(tab) : "skipped";
        const outcome = await saveToPath(tabId, true);
        if (outcome === "saved") await followTitle(tabId);
        return outcome;
      }),
    [liveTabs, saveToPath, serialized, autosaveUntitled, followTitle],
  );

  return autosaveTab;
}
