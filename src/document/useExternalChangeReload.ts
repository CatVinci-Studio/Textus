import { windowLayout } from "../engine/layout/store";
import { panesOf } from "../engine/layout/tree";
import { useEffect } from "react";
import { thisWindow } from "../platform/this-window";
import { readDocText, statMtime, tabIsDirty, type DocTab } from "./doc-tabs";
import { unlistenAll } from "../platform/events";
import { FILE_RELOADED_EVENT, FILE_WRITTEN_EVENT } from "../utils/events";
import { fileTextFor } from "./tracked-file";
import { openDocumentAt } from "../registry/open-documents";

// On focus, or when something in the window wrote a file, clean tabs whose
// file changed on disk take the new text (in place when open in an editor);
// dirty tabs wait for the save-time prompt.
// While the window shows, the documents on screen are also checked every
// moment, so another app writing one shows up without a click back into
// Textus. `liveTabs` includes edits the editor hasn't reported yet.

/** How often the shown documents' times are read while the window shows. */
const WATCH_MS = 1500;

/** The tabs whose documents are on screen: each island's in front. */
function shownTabIds(): Set<string> {
  return new Set(
    panesOf(windowLayout().root).flatMap((pane) =>
      pane.front ? [pane.front] : [],
    ),
  );
}

/**
 * Tab `tab` takes `content`, its file's text on disk at `mtime`, as saved:
 * in place when open in an editor - one undo step, so the AI conversation
 * the editor holds goes on (an agent writing the file itself, mid-turn) -
 * otherwise by a remount.
 */
export function takeDiskText(
  tab: DocTab,
  content: string,
  mtime: number,
  liveTabs: () => DocTab[],
  updateTab: (id: string, patch: Partial<DocTab>) => void,
): void {
  if (!tab.path) return;
  const open = openDocumentAt(tab.path);
  if (open?.replaceText(content, open.revision())) {
    // As the editor writes it out: what it reports from now on.
    const shown = liveTabs().find((tb) => tb.id === tab.id)?.content ?? content;
    updateTab(tab.id, {
      content: shown,
      savedContent: shown,
      diskMtime: mtime,
    });
  } else
    updateTab(tab.id, {
      content,
      savedContent: content,
      diskMtime: mtime,
      reloadKey: tab.reloadKey + 1,
    });
  window.dispatchEvent(
    new CustomEvent(FILE_RELOADED_EVENT, { detail: tab.path }),
  );
}

export function useExternalChangeReload(
  liveTabs: () => DocTab[],
  updateTab: (id: string, patch: Partial<DocTab>) => void,
): void {
  useEffect(() => {
    let checking = false;
    let again = false;
    const check = (only?: Set<string>) => {
      if (checking) {
        again = true;
        return;
      }
      checking = true;
      void (async () => {
        for (const tab of liveTabs()) {
          if (!tab.path || (only && !only.has(tab.id))) continue;
          const mtime = await statMtime(tab.path);
          // Deleted or unreadable: keep the buffer as-is; Save asks before recreating.
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
          if (
            content === live.savedContent ||
            content === fileTextFor(tab.path, live.savedContent)
          ) {
            updateTab(tab.id, { diskMtime: mtime });
            continue;
          }
          takeDiskText(live, content, mtime, liveTabs, updateTab);
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
    const checkAll = () => check();
    window.addEventListener(FILE_WRITTEN_EVENT, checkAll);
    const stopFocus = unlistenAll(unlisten);
    const watch = setInterval(() => {
      if (document.visibilityState === "visible") check(shownTabIds());
    }, WATCH_MS);
    return () => {
      window.removeEventListener(FILE_WRITTEN_EVENT, checkAll);
      stopFocus();
      clearInterval(watch);
    };
  }, [updateTab, liveTabs]);
}
