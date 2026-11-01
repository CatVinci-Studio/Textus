import { useCallback, useEffect, useRef } from "react";
import { showConfirm, showMessage } from "../ui/app-dialog";
import { migrateDraftImages } from "../editor/images/image-migration";
import { basename, parentDir } from "../utils/path";
import {
  statMtime,
  tabIsDirty,
  tabTitle,
  writeDocFile,
  type DocTab,
} from "../document/doc-tabs";
import {
  freeFilePath,
  untitledAutosavable,
} from "../document/autosave-untitled";
import {
  fileTextFor,
  setTrackedWriter,
  writeRevisions,
} from "../document/tracked-file";
import type { SaveOutcome } from "../document/autosave";
import { fs, session } from "../platform/ipc";
import { moveConversations } from "../ai/chat/chat-history";
import {
  defaultMarkdownFilename,
  markdownFilename,
} from "../document/save-default-name";
import { isWordDocument, wordSaveSuggestion } from "../document/word-import";
import {
  emitPluginEvent,
  notePathMoved,
  openDocumentAt,
} from "../plugins/app-bridge";
import { hasWillSave, runWillSave } from "../plugins/contributions/will-save";
import type { Strings } from "../i18n/strings";
import type { TabState } from "./tabs/useTabState";
import { errorText } from "../utils/error-text";
import { explainError } from "../utils/error-explain";

/** The save queue untitled drafts' first autosaves share. */
const UNTITLED_QUEUE = "\0untitled";

/** Save and Save As for this window's tabs. Both resolve true only when the
 *  document actually reached disk. */
export function useSaveTabs(opts: {
  tabState: TabState;
  t: Strings;
  autoSuggestFilename: boolean;
  imageFolder: string;
  /** The folder open in the window, where untitled drafts are autosaved;
   *  with none they are left to draft recovery. */
  folder?: string | null;
  /** The title the AI gave an untitled draft, if it has one yet. */
  aiTitleFor?: (tab: DocTab) => string | null;
}) {
  const { tabState, t, autoSuggestFilename, imageFolder, aiTitleFor } = opts;
  const folder = opts.folder ?? null;
  const { liveTabs, updateTab, tabsRef } = tabState;

  // Writes a document, or says why it couldn't and resolves false; the tab
  // stays dirty, so nothing is lost. A tracked document's file gets its
  // original, its changes going beside it; `from` is where it was tracked.
  const writeOrReport = useCallback(
    async (
      path: string,
      content: string,
      from: string | null = path,
    ): Promise<boolean> => {
      try {
        await writeDocFile(path, fileTextFor(from, content));
        await writeRevisions(path, content, from);
        return true;
      } catch (err) {
        const lines = [
          t.saveFailedMessage.replace("{name}", basename(path)),
          /read-only|permission denied/i.test(errorText(err))
            ? t.saveReadOnlyHint
            : explainError(err, t),
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

  // A draft's first file, or a document's new one: written, its images
  // brought along, and the tab pointed at it. tabsRef is patched too, so an
  // autosave right behind this one sees the path and doesn't save it again.
  const adoptFile = useCallback(
    async (tab: DocTab, picked: string, auto: boolean): Promise<boolean> => {
      if (!(await writeOrReport(picked, tab.content, tab.path))) return false;
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
      // Typing during an autosave stays: only an editor still showing what
      // was written takes the rewritten text (and has to load it).
      const typedOn =
        liveTabs().find((tb) => tb.id === tab.id)?.content !== tab.content;
      const patch: Partial<DocTab> = {
        path: picked,
        importedFrom: undefined,
        savedContent: content,
        diskMtime: await statMtime(picked),
        ...(content !== tab.content && !typedOn
          ? { content, reloadKey: tab.reloadKey + 1 }
          : {}),
      };
      tabsRef.current = tabsRef.current.map((tb) =>
        tb.id === tab.id ? { ...tb, ...patch } : tb,
      );
      updateTab(tab.id, patch);
      // Its past conversations follow it to the new name.
      if (tab.path) moveConversations(tab.path, picked);
      emitPluginEvent("didSave", {
        path: picked,
        text: content,
        trigger: auto ? "auto" : "manual",
      });
      return true;
    },
    [updateTab, liveTabs, tabsRef, t, imageFolder, writeOrReport],
  );

  const suggestedName = useCallback(
    (tab: DocTab): string => {
      const fallback = tab.helpDoc ? tabTitle(tab, t) : t.untitledTab;
      const title = autoSuggestFilename ? aiTitleFor?.(tab) : null;
      return title
        ? markdownFilename(title, fallback)
        : defaultMarkdownFilename(tab.content, fallback, autoSuggestFilename);
    },
    [t, autoSuggestFilename, aiTitleFor],
  );

  // Files autosave named itself, by tab: they follow the title until the
  // user names them (Save As, or a rename that moves the tab elsewhere).
  const autoNamed = useRef(new Map<string, string>());

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
        : (fromWord?.name ?? suggestedName(tab));
      const picked = await fs.saveFileDialog(defaultName, fromWord?.dir);
      if (!picked) return false;
      // Markdown written into a .docx would destroy the Word document.
      if (isWordDocument(picked)) {
        await showMessage(t.wordSaveRefused, { tone: "warning" });
        return false;
      }
      autoNamed.current.delete(tabId);
      return adoptFile(tab, picked, false);
    },
    [liveTabs, t, suggestedName, adoptFile],
  );

  // tabsRef is patched as well as the state, so a save right behind this one
  // compares against this write's mtime and doesn't see it as external.
  const commitSaved = useCallback(
    async (tabId: string, path: string, content: string, auto: boolean) => {
      const patch = { savedContent: content, diskMtime: await statMtime(path) };
      tabsRef.current = tabsRef.current.map((tb) =>
        tb.id === tabId && tb.path === path ? { ...tb, ...patch } : tb,
      );
      updateTab(tabId, patch);
      // Plugins listening for saves (version history) are told.
      emitPluginEvent("didSave", {
        path,
        text: content,
        trigger: auto ? "auto" : "manual",
      });
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
      await commitSaved(tabId, tab.path, content, auto);
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

  // An untitled draft's first autosave: into the window's open folder,
  // named as Save As would suggest and numbered rather than overwriting. One
  // at a time across tabs, so two drafts of the same name can't both take
  // it. With no folder open it stays a draft.
  const autosaveUntitled = useCallback(
    (tab: DocTab): Promise<SaveOutcome> =>
      serialized(UNTITLED_QUEUE, async () => {
        if (!folder) return "skipped";
        const path = await freeFilePath(
          folder,
          suggestedName(tab),
          async (p) => (await statMtime(p)) !== null,
        );
        if (!path) return "skipped";
        if (!(await adoptFile(tab, path, true))) return "failed";
        autoNamed.current.set(tab.id, path);
        return "saved";
      }),
    [serialized, folder, suggestedName, adoptFile],
  );

  // A file autosave named: renamed after the title as it changes. Anything
  // in the way (a rename refused, the name taken) leaves it where it is.
  const followTitle = useCallback(
    async (tabId: string) => {
      const tab = liveTabs().find((tb) => tb.id === tabId);
      const from = tab?.path;
      const dir = from && parentDir(from);
      if (!tab || !from || !dir || autoNamed.current.get(tabId) !== from) {
        autoNamed.current.delete(tabId);
        return;
      }
      const wanted = suggestedName(tab);
      if (wanted === basename(from)) return;
      // Its own file is no obstacle, in any case (macOS ignores it).
      const to = await freeFilePath(
        dir,
        wanted,
        async (p) =>
          p.toLowerCase() !== from.toLowerCase() &&
          (await statMtime(p)) !== null,
      );
      if (!to || to === from) return;
      let moved: string;
      try {
        moved = await fs.renameEntry(from, basename(to));
      } catch {
        autoNamed.current.delete(tabId);
        return;
      }
      autoNamed.current.set(tabId, moved);
      tabsRef.current = tabsRef.current.map((tb) =>
        tb.id === tabId ? { ...tb, path: moved } : tb,
      );
      updateTab(tabId, { path: moved });
      moveConversations(from, moved);
      void notePathMoved(from, moved);
      void session.addRecentFile(moved);
    },
    [liveTabs, tabsRef, updateTab, suggestedName],
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

  // A tracked document's original moved with nothing unsaved in it: its file
  // follows at once, as a save would write it.
  useEffect(() => {
    setTrackedWriter((path) => {
      const tab = liveTabs().find((tb) => tb.path === path);
      if (!tab || tabIsDirty(tab)) return;
      void serialized(tab.id, async () => {
        if (await writeOrReport(path, tab.content))
          await commitSaved(tab.id, path, tab.content, true);
      });
    });
    return () => setTrackedWriter(null);
  }, [liveTabs, serialized, writeOrReport, commitSaved]);

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
