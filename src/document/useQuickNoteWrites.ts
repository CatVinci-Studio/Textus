import { useEffect } from "react";
import { statMtime, type DocTab } from "./doc-tabs";
import { reloadChangedTabs } from "./useExternalChangeReload";
import { notePreview, syncWithQuickNote } from "./quick-note-merge";
import { QUICK_NOTE_WRITTEN, type QuickNoteWritten } from "../platform/ipc";
import { listenToThisWindow, unlistenAll } from "../utils/tauri-events";

/**
 * A quick note was saved to a file this window has open (Rust tells every
 * editor window, src-tauri/src/commands/quick_note/): a tab without unsaved
 * edits shows the file again at once, as on a return to the window
 * (useExternalChangeReload.ts); one with unsaved edits takes in an entry
 * the day's file gained at its end, and otherwise keeps its edits and
 * remembers the note, so the save-time "changed on disk" prompt says a
 * quick note would be lost (useSaveTabs.ts). quick-note-merge.ts has the
 * rule.
 */
export function useQuickNoteWrites(
  liveTabs: () => DocTab[],
  updateTab: (id: string, patch: Partial<DocTab>) => void,
): void {
  useEffect(
    () =>
      unlistenAll(
        listenToThisWindow<QuickNoteWritten>(
          QUICK_NOTE_WRITTEN,
          ({ payload }) => {
            void (async () => {
              const ofFile = (tab: DocTab) => tab.path === payload.path;
              const mtime = await statMtime(payload.path);
              // Read after the await, and applied without another: an
              // edit typed meanwhile is part of what gets merged.
              for (const tab of liveTabs().filter(ofFile)) {
                const sync = syncWithQuickNote(tab, payload);
                if (sync.kind === "reload")
                  void reloadChangedTabs(
                    liveTabs,
                    updateTab,
                    (t) => t.id === tab.id,
                  );
                else if (sync.kind === "unchanged")
                  updateTab(tab.id, { diskMtime: mtime });
                else if (sync.kind === "merge")
                  updateTab(tab.id, {
                    content: sync.content,
                    savedContent: sync.savedContent,
                    diskMtime: mtime,
                    reloadKey: tab.reloadKey + 1,
                  });
                else
                  updateTab(tab.id, {
                    quickNoteConflict: notePreview(
                      payload.entry ?? payload.after,
                    ),
                  });
              }
            })();
          },
        ),
      ),
    [liveTabs, updateTab],
  );
}
