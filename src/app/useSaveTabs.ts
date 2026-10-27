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
import { emitPluginEvent, openDocumentAt } from "../plugins/app-bridge";
import { hasWillSave, runWillSave } from "../plugins/contributions/will-save";
import type { Strings } from "../i18n/strings";
import type { TabState } from "./tabs/useTabState";

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

  // Writes a document, or says why it couldn't and resolves false; the tab
  // stays dirty, so nothing is lost.
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

  // Always asks where to write. Resolves true only when the document reached
  // disk, so a cancelled dialog doesn't close the tab.
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
      // Markdown written into a .docx would destroy the Word document.
      if (isWordDocument(picked)) {
        await showMessage(t.wordSaveRefused, { tone: "warning" });
        return false;
      }
      if (!(await writeOrReport(picked, tab.content))) return false;
      void session.addRecentFile(picked);
      // Pasted images in a first-saved draft move into its image folder with
      // relative paths; saved to another folder, relative images are copied.
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
      // Its past conversations follow it to the new name.
      if (tab.path) moveConversations(tab.path, picked);
      emitPluginEvent("didSave", { path: picked, text: content });
      return true;
    },
    [updateTab, liveTabs, t, autoSuggestFilename, imageFolder, writeOrReport],
  );

  // tabsRef is patched as well as the state, so a save right behind this one
  // compares against this write's mtime and doesn't see it as external.
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

  // "conflict": the file changed on disk and the user kept that version.
  // `auto`: the prompt starts on Cancel, since the user didn't ask to save.
  const saveToPath = useCallback(
    async (tabId: string, auto: boolean): Promise<SaveOutcome> => {
      const tab = liveTabs().find((tb) => tb.id === tabId);
      if (!tab?.path) return "skipped";
      // Changed on disk since it was read: ask before overwriting. A null
      // mtime means it was deleted, and writing recreates it.
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
      const content = await beforeSave(tab.path, tab.content);
      if (!(await writeOrReport(tab.path, content))) return "failed";
      await commitSaved(tabId, tab.path, content);
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
      // Never saved: ask where to put it.
      if (!tab.path) return saveTabAs(tabId);
      return (
        (await serialized(tabId, () => saveToPath(tabId, false))) === "saved"
      );
    },
    [liveTabs, saveTabAs, saveToPath, serialized],
  );

  /** Autosave: File > Save for a changed document that has a file, never a
   *  Save As. Conflicts and failures prompt as a manual save does. */
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

/**
 * The text to save once onWillSave plugins have changed it, put into the
 * editor first as one undo step so what is saved is what shows.
 */
async function beforeSave(path: string, text: string): Promise<string> {
  if (!hasWillSave()) return text;
  const changed = await runWillSave(path, text);
  if (changed === text) return text;
  const doc = openDocumentAt(path);
  if (!doc?.replaceText(changed, doc.revision())) return text;
  return doc.text();
}
