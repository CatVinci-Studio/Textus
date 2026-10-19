import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readDocText, statMtime, tabIsDirty, type DocTab } from "./doc-tabs";
import { unlistenAll } from "../utils/tauri-events";

type LiveTabs = () => DocTab[];
type UpdateTab = (id: string, patch: Partial<DocTab>) => void;

// External-change pickup: whenever this window regains focus, compare each
// on-disk tab's live mtime against the snapshot taken at read/save time.
// Clean tabs silently reload (reloadKey remounts the editor on the new
// content); dirty tabs are left alone - their unsaved edits stay, and the
// conflict surfaces as saveTab's overwrite prompt instead. A tab with no
// snapshot (its mtime was unreadable when the document was read) just
// adopts the current mtime as its baseline.
//
// `liveTabs` is app/useTabState.ts's: a clean-looking tab can still hold an
// edit the editor hasn't reported yet, and reloading it would remount the
// editor over that edit.
export function useExternalChangeReload(
  liveTabs: LiveTabs,
  updateTab: UpdateTab,
): void {
  useEffect(() => {
    let checking = false;
    const unlisten = getCurrentWindow().onFocusChanged(
      ({ payload: focused }) => {
        if (!focused || checking) return;
        checking = true;
        void reloadChangedTabs(liveTabs, updateTab).finally(() => {
          checking = false;
        });
      },
    );
    return unlistenAll(unlisten);
  }, [updateTab, liveTabs]);
}

/** The check the focus handler runs, for the tabs `only` picks (all of
 *  them without it) - also called when this window learns a file changed,
 *  as when a quick note is written to it (useQuickNoteWrites.ts). */
export async function reloadChangedTabs(
  liveTabs: LiveTabs,
  updateTab: UpdateTab,
  only: (tab: DocTab) => boolean = () => true,
): Promise<void> {
  for (const tab of liveTabs()) {
    if (!tab.path || !only(tab)) continue;
    const mtime = await statMtime(tab.path);
    // Deleted or unreadable: keep the buffer as-is; Save recreates it.
    if (mtime === null) continue;
    if (tab.diskMtime === null) {
      updateTab(tab.id, { diskMtime: mtime });
      continue;
    }
    if (mtime === tab.diskMtime) continue;
    if (tabIsDirty(tab)) continue; // dirty: defer to the save-time prompt
    const content = await readDocText(tab.path).catch(() => null);
    if (content === null) continue;
    // Re-check against the LIVE tab: the user may have started typing
    // (or the tab may be gone) while the read above was in flight, and
    // clobbering those fresh edits with disk content would lose them.
    const live = liveTabs().find((tb) => tb.id === tab.id);
    if (!live || tabIsDirty(live)) continue;
    // Touched but not changed (iCloud and the Files app re-stamp a
    // document, and the phone checks on every return to the app):
    // a remount would only throw away the open AI conversation.
    if (content === live.savedContent) {
      updateTab(tab.id, { diskMtime: mtime });
      continue;
    }
    updateTab(tab.id, {
      content,
      savedContent: content,
      diskMtime: mtime,
      reloadKey: live.reloadKey + 1,
      quickNoteConflict: undefined,
    });
  }
}
