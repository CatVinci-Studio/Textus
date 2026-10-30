import { useEffect } from "react";
import { thisWindow } from "../platform/this-window";
import { readDocText, statMtime, tabIsDirty, type DocTab } from "./doc-tabs";
import { unlistenAll } from "../platform/events";
import { FILE_RELOADED_EVENT, FILE_WRITTEN_EVENT } from "../utils/events";

// On focus, when something in the window wrote a file, and every moment the
// window is on screen, clean tabs whose file changed on disk reload; dirty
// tabs wait for the save-time prompt. Another app writing the file shows up
// here without a click back into Textus. `liveTabs` includes edits the
// editor hasn't reported yet.

/** How often the open files' times are read while the window shows. */
const WATCH_MS = 1500;

export function useExternalChangeReload(
  liveTabs: () => DocTab[],
  updateTab: (id: string, patch: Partial<DocTab>) => void,
): void {
  useEffect(() => {
    let checking = false;
    let again = false;
    const check = () => {
      if (checking) {
        again = true;
        return;
      }
      checking = true;
      void (async () => {
        for (const tab of liveTabs()) {
          if (!tab.path) continue;
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
          // Re-check the live tab: the user may have typed during the read.
          const live = liveTabs().find((tb) => tb.id === tab.id);
          if (!live || tabIsDirty(live)) continue;
          // Touched but unchanged (iCloud re-stamps files): a remount would
          // only throw away the open AI conversation.
          if (content === live.savedContent) {
            updateTab(tab.id, { diskMtime: mtime });
            continue;
          }
          updateTab(tab.id, {
            content,
            savedContent: content,
            diskMtime: mtime,
            reloadKey: live.reloadKey + 1,
          });
          window.dispatchEvent(
            new CustomEvent(FILE_RELOADED_EVENT, { detail: tab.path }),
          );
        }
      })().finally(() => {
        checking = false;
        if (again) {
          again = false;
          check();
        }
      });
    };
    const unlisten = thisWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) check();
    });
    window.addEventListener(FILE_WRITTEN_EVENT, check);
    const stopFocus = unlistenAll(unlisten);
    const watch = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, WATCH_MS);
    return () => {
      window.removeEventListener(FILE_WRITTEN_EVENT, check);
      stopFocus();
      clearInterval(watch);
    };
  }, [updateTab, liveTabs]);
}
