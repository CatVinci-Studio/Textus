import { useCallback, useRef } from "react";
import { showConfirm, showMessage } from "../ui/app-dialog";
import { migrateDraftImages } from "../editor/images/image-migration";
import { basename } from "../utils/path";
import { errorText } from "../utils/error-text";
import {
  statMtime,
  tabIsDirty,
  tabTitle,
  writeDocFile,
} from "../document/doc-tabs";
import type { SaveOutcome } from "../document/autosave";
import { fs, session } from "../platform/ipc";
import { moveConversations } from "../ai/chat/chat-history";
import { defaultMarkdownFilename } from "../document/save-default-name";
import { isWordDocument, wordSaveSuggestion } from "../document/word-import";
import { emitPluginEvent } from "../plugins/app-bridge";
import type { Strings } from "../i18n/strings";
import type { TabState } from "./useTabState";

/** Save and Save As for this window's tabs. Both resolve true only when the
 *  document actually reached disk. */
export function useSaveTabs(opts: {
  tabState: TabState;
  t: Strings;
  autoSuggestFilename: boolean;
  imageFolder: string;
}) {
  const { tabState, t, autoSuggestFilename, imageFolder } = opts;
  const { liveTabs, updateTab, tabsRef } = tabState;

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
      // A plugin's tab (a PDF) has no document of ours to save.
      if (!tab || tab.view) return false;
      // Made from a Word document: a .md of the same name, beside it.
      const fromWord = tab.importedFrom
        ? wordSaveSuggestion(tab.importedFrom)
        : null;
      const defaultName = tab.path
        ? basename(tab.path)
        : (fromWord?.name ??
          defaultMarkdownFilename(
            tab.content,
            tab.helpDoc ? tabTitle(tab, t) : t.untitledTab,
            autoSuggestFilename,
          ));
      const picked = await fs.saveFileDialog(defaultName, fromWord?.dir);
      if (!picked) return false;
      // Markdown written into a .docx would destroy the Word document - the
      // one this was opened from, most likely.
      if (isWordDocument(picked)) {
        await showMessage(t.wordSaveRefused, { tone: "warning" });
        return false;
      }
      if (!(await writeOrReport(picked, tab.content))) return false;
      void session.addRecentFile(picked);
      // First save of a draft: any pasted images it holds live in the app's
      // data dir with an absolute src (fs.rs's save_pasted_image) - now that
      // the document has a real home, move them into its image folder and
      // rewrite the markdown to relative paths (4.2). Saved as a file in
      // another folder, its relative images are copied along the same way.
      // A no-op for documents with neither.
      let { content } = tab;
      try {
        const migration = await migrateDraftImages(
          picked,
          tab.content,
          imageFolder,
          tab.path,
        );
        if (migration.migrated) {
          content = migration.content;
          await writeDocFile(picked, content);
        }
        if (migration.failed.length > 0) {
          void showMessage(
            `${t.imageMigrationFailedMessage}\n${migration.failed.join("\n")}`,
            {
              title: t.imageMigrationFailedTitle,
              tone: "warning",
            },
          );
        }
      } catch (err) {
        console.error("[image-migration] failed:", err);
      }
      updateTab(tabId, {
        path: picked,
        importedFrom: undefined,
        content,
        savedContent: content,
        diskMtime: await statMtime(picked),
        // Image migration rewrote the markdown: the editor has to load it.
        ...(content !== tab.content ? { reloadKey: tab.reloadKey + 1 } : {}),
      });
      // The document goes on under its new name, and its past
      // conversations with it.
      if (tab.path) moveConversations(tab.path, picked);
      emitPluginEvent("didSave", { path: picked, text: content });
      return true;
    },
    [updateTab, liveTabs, t, autoSuggestFilename, imageFolder, writeOrReport],
  );

  // A save that reached disk: the tab turns clean and takes the file's new
  // mtime. tabsRef is patched as well as the state, so a save of the same
  // tab right behind this one (an autosave, a close) compares the disk
  // against this write's mtime - the state only reaches tabsRef on the next
  // render, and the old mtime would make our own write look external.
  const commitSaved = useCallback(
    async (tabId: string, path: string, content: string) => {
      const patch = { savedContent: content, diskMtime: await statMtime(path) };
      tabsRef.current = tabsRef.current.map((tb) =>
        tb.id === tabId && tb.path === path ? { ...tb, ...patch } : tb,
      );
      updateTab(tabId, patch);
      // Plugins listening for saves (version history) are told.
      emitPluginEvent("didSave", { path, text: content });
    },
    [tabsRef, updateTab],
  );

  // Writes a document that already has a file. "conflict": the file changed
  // on disk and the user chose to keep that version. `auto`: an autosave
  // asked, so the prompt starts on Cancel - the user didn't ask to save.
  const saveToPath = useCallback(
    async (tabId: string, auto: boolean): Promise<SaveOutcome> => {
      const tab = liveTabs().find((tb) => tb.id === tabId);
      if (!tab?.path) return "skipped";
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
            focusCancel: auto,
          });
          if (!overwrite) return "conflict";
        }
      }
      if (!(await writeOrReport(tab.path, tab.content))) return "failed";
      await commitSaved(tabId, tab.path, tab.content);
      return "saved";
    },
    [liveTabs, t, writeOrReport, commitSaved],
  );

  // One save per tab at a time: a racing save would see our own write as external.
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

  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = liveTabs().find((tb) => tb.id === tabId);
      if (!tab) return false;
      // Draft never saved before: ask where to put it, then this document
      // graduates into a real file (the sidebar tree picks up its folder).
      if (!tab.path) return saveTabAs(tabId);
      return (
        (await serialized(tabId, () => saveToPath(tabId, false))) === "saved"
      );
    },
    [liveTabs, saveTabAs, saveToPath, serialized],
  );

  /** Settings › General › Save Automatically: File > Save for a document
   *  that already has a file and has changed - never a Save As. A conflict
   *  or a failure shows the same prompt or error a manual save does;
   *  document/autosave.ts sees that it is shown once. */
  const autosaveTab = useCallback(
    (tabId: string): Promise<SaveOutcome> =>
      serialized(tabId, async () => {
        const tab = liveTabs().find((tb) => tb.id === tabId);
        if (!tab?.path || !tabIsDirty(tab)) return "skipped";
        return saveToPath(tabId, true);
      }),
    [liveTabs, saveToPath, serialized],
  );

  return { saveTab, saveTabAs, autosaveTab };
}
