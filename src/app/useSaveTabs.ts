import { useCallback } from "react";
import { showConfirm, showMessage } from "../ui/app-dialog";
import { migrateDraftImages } from "../editor/images/image-migration";
import { basename } from "../utils/path";
import { errorText } from "../utils/error-text";
import { statMtime, tabTitle, writeDocFile } from "../document/doc-tabs";
import { fs, session, media } from "../platform/ipc";
import { defaultMarkdownFilename } from "../document/save-default-name";
import type { Strings } from "../i18n/strings";
import type { TabState } from "./useTabState";

/** Save and Save As for this window's tabs. Both resolve true only when the
 *  document actually reached disk. */
export function useSaveTabs(opts: {
  tabState: TabState;
  t: Strings;
  autoSuggestFilename: boolean;
}) {
  const { tabState, t, autoSuggestFilename } = opts;
  const { liveTabs, updateTab } = tabState;

  // Writes a document, or says why it couldn't and resolves false - the tab
  // stays dirty, so nothing is lost. A failed save used to be silent: the
  // unsaved dot simply stayed, and a read-only file gave no reason at all.
  const writeOrReport = useCallback(
    async (path: string, content: string): Promise<boolean> => {
      try {
        await writeDocFile(path, content);
        return true;
      } catch (err) {
        const reason = errorText(err);
        const lines = [
          t.saveFailedMessage.replace("{name}", basename(path)),
          /read-only|permission denied/i.test(reason)
            ? t.saveReadOnlyHint
            : reason,
        ];
        await showMessage(lines.join("\n"), {
          title: t.saveFailedTitle,
          tone: "error",
        });
        return false;
      }
    },
    [t],
  );

  // Resolves true only when the document actually reached disk - the close
  // prompt must not close the window (or remove the tab) when a save-as
  // dialog was cancelled.
  // Always asks where to write, regardless of whether the document already
  // has a path - File > Save As…, and the "first save of a draft" case.
  const saveTabAs = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = liveTabs().find((tb) => tb.id === tabId);
      if (!tab) return false;
      const defaultName = tab.path
        ? basename(tab.path)
        : defaultMarkdownFilename(
            tab.content,
            tab.helpDoc ? tabTitle(tab, t) : t.untitledTab,
            autoSuggestFilename,
          );
      const picked = await fs.saveFileDialog(defaultName);
      if (!picked) return false;
      // First save of a draft: any pasted images it holds live in the app's
      // data dir with an absolute src (fs.rs's save_pasted_image) - now that
      // the document has a real home, copy them into assets/ next to it and
      // rewrite the markdown to relative paths (4.2). A no-op for documents
      // with no draft-origin images.
      let { content } = tab;
      try {
        const migration = await migrateDraftImages(
          picked,
          tab.content,
          tab.path,
        );
        if (migration.migrated) {
          content = migration.content;
        }
        if (migration.failed.length > 0) {
          await showMessage(
            `${t.imageMigrationFailedMessage}\n${migration.failed.join("\n")}`,
            {
              title: t.imageMigrationFailedTitle,
              tone: "warning",
            },
          );
          return false;
        }
        if (!(await writeOrReport(picked, content))) return false;
        if (migration.mappings.length)
          await media.rebaseImageAssets(
            tab.workspaceId ?? tab.id,
            migration.mappings,
          );
      } catch (err) {
        await showMessage(errorText(err), {
          title: t.imageMigrationFailedTitle,
          tone: "error",
        });
        return false;
      }
      void session.addRecentFile(picked);
      updateTab(tabId, {
        path: picked,
        content,
        savedContent: content,
        diskMtime: await statMtime(picked),
        // Image migration rewrote the markdown: the editor has to load it.
        ...(content !== tab.content ? { reloadKey: tab.reloadKey + 1 } : {}),
      });
      return true;
    },
    [updateTab, liveTabs, t, autoSuggestFilename, writeOrReport],
  );

  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = liveTabs().find((tb) => tb.id === tabId);
      if (!tab) return false;
      // Draft never saved before: ask where to put it, then this document
      // graduates into a real file (the sidebar tree picks up its folder).
      if (!tab.path) return saveTabAs(tabId);
      // The file changed on disk since it was read (another app, git, a sync
      // service): saving now would silently destroy those changes, so ask.
      // A null current mtime means the file was deleted - writing simply
      // recreates it, nothing to protect.
      if (tab.diskMtime !== null) {
        const current = await statMtime(tab.path);
        if (current !== null && current !== tab.diskMtime) {
          const overwrite = await showConfirm(t.fileChangedOnDiskMessage, {
            title: t.fileChangedOnDiskTitle,
            okLabel: t.fileChangedOnDiskOverwrite,
            cancelLabel: t.closePromptCancel,
          });
          if (!overwrite) return false;
        }
      }
      if (!(await writeOrReport(tab.path, tab.content))) return false;
      updateTab(tabId, {
        savedContent: tab.content,
        diskMtime: await statMtime(tab.path),
      });
      return true;
    },
    [updateTab, liveTabs, saveTabAs, t, writeOrReport],
  );

  return { saveTab, saveTabAs };
}
