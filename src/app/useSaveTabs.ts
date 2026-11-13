import { announceFileCreated } from "../utils/events";
import { fill } from "../i18n/fill";
import { useCallback, useEffect, useRef } from "react";
import {
  showChoice,
  showConfirm,
  showMessage,
} from "../engine/controls/app-dialog";
import { takeDiskText } from "../document/useExternalChangeReload";
import { migrateDraftImages } from "../editor/images/image-migration";
import { basename, parentDir } from "../utils/path";
import {
  readDocText,
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
import { emitPluginEvent, notePathMoved } from "../plugins/app-bridge";
import { openDocumentAt } from "../registry/open-documents";
import { hasWillSave, runWillSave } from "../plugins/contributions/will-save";
import type { Strings } from "../i18n/strings";
import type { TabState } from "./tabs/useTabState";
import { errorText } from "../utils/error-text";
import { getUiState, setUiState } from "../storage/ui-state";
import { explainError } from "../utils/error-explain";

/** The save queue untitled drafts' first autosaves share. */
const UNTITLED_QUEUE = "\0untitled";

/** Save and Save As for this window's tabs. Both resolve true only when the
 *  document actually reached disk. */
/** Where Save As starts: the document's own folder, else the folder open
 *  in the window, else the one the last document was saved into. */
export function saveFolder(
  path: string | null | undefined,
  openFolder: string | null,
): string | null {
  if (path) return parentDir(path) || null;
  if (openFolder) return openFolder;
  const last = getUiState("lastSaveFolder");
  return typeof last === "string" && last ? last : null;
}

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
  const { liveTabs, updateTab } = tabState;

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
          fill(t.saveFailedMessage, { name: basename(path) }),
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
      // Saved over a file already there: not a new one to plugins.
      const existed = (await statMtime(picked)) !== null;
      if (!(await writeOrReport(picked, tab.content, tab.path))) return false;
      void session.addRecentFile(picked);
      if (!existed) announceFileCreated(picked);
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
      // Typing during an autosave stays, its pictures pointed where they
      // moved to as well: the editor loads the rewritten text either way.
      const live = liveTabs().find((tb) => tb.id === tab.id)?.content;
      const shown =
        live === undefined || live === tab.content
          ? content
          : movedPictures(tab.content, content, live);
      const patch: Partial<DocTab> = {
        path: picked,
        importedFrom: undefined,
        savedContent: content,
        diskMtime: await statMtime(picked),
        ...(shown !== (live ?? tab.content)
          ? { content: shown, reloadKey: tab.reloadKey + 1 }
          : {}),
      };
      updateTab(tab.id, patch);
      // Its past conversations follow it to the new name.
      if (tab.path) moveConversations(tab.path, picked);
      emitPluginEvent("didSave", {
        path: picked,
        text: content,
        trigger: auto ? "auto" : "manual",
      });
      if (!auto) emitPluginEvent("activity", { kind: "saved" });
      return true;
    },
    [updateTab, liveTabs, t, imageFolder, writeOrReport],
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
      const picked = await fs.saveFileDialog(
        defaultName,
        fromWord?.dir ?? saveFolder(tab.path, folder),
      );
      if (!picked) return false;
      const pickedDir = parentDir(picked);
      if (pickedDir) setUiState("lastSaveFolder", pickedDir);
      // Markdown written into a .docx would destroy the Word document.
      if (isWordDocument(picked)) {
        await showMessage(t.wordSaveRefused, { tone: "warning" });
        return false;
      }
      autoNamed.current.delete(tabId);
      return adoptFile(tab, picked, false);
    },
    [liveTabs, t, suggestedName, adoptFile, folder],
  );

  // Into the model at once, so a save right behind this one compares
  // against this write's mtime and doesn't see it as external.
  const commitSaved = useCallback(
    async (tabId: string, path: string, content: string, auto: boolean) => {
      const patch = { savedContent: content, diskMtime: await statMtime(path) };
      updateTab(tabId, patch);
      // Plugins listening for saves (version history) are told.
      emitPluginEvent("didSave", {
        path,
        text: content,
        trigger: auto ? "auto" : "manual",
      });
      if (!auto) emitPluginEvent("activity", { kind: "saved" });
    },
    [updateTab],
  );

  // "conflict": the file changed on disk and the user didn't overwrite it
  // (kept it, or took its text).
  // `auto`: the prompt starts on Cancel, since the user didn't ask to save.
  const saveToPath = useCallback(
    async (tabId: string, auto: boolean): Promise<SaveOutcome> => {
      const tab = liveTabs().find((tb) => tb.id === tabId);
      if (!tab?.path) return "skipped";
      // Changed, moved or deleted on disk since it was read: ask before
      // writing, so a file renamed elsewhere isn't recreated under its old name.
      if (tab.diskMtime !== null) {
        const current = await statMtime(tab.path);
        if (current !== tab.diskMtime) {
          if (current === null) {
            const recreate = await showConfirm(t.fileGoneOnDiskMessage, {
              title: t.fileGoneOnDiskTitle,
              okLabel: t.fileGoneOnDiskRecreate,
              cancelLabel: t.cancel,
              focusCancel: auto,
            });
            if (!recreate) return "conflict";
          } else {
            // Overwrite it with this text, or take the other text instead.
            const choice = await showChoice(t.fileChangedOnDiskMessage, {
              title: t.fileChangedOnDiskTitle,
              okLabel: t.fileChangedOnDiskOverwrite,
              altLabel: t.fileChangedOnDiskReload,
              cancelLabel: t.cancel,
              focusCancel: auto,
            });
            if (choice === "alt") {
              const disk = await readDocText(tab.path).catch(() => null);
              const live = liveTabs().find((tb) => tb.id === tabId);
              if (disk !== null && live)
                takeDiskText(live, disk, current, liveTabs, updateTab);
            }
            if (choice !== "ok") return "conflict";
          }
        }
      }
      // Changed by a plugin: what the editor now holds, as it writes files;
      // with no rendered editor (source mode), the plugin's text, which the
      // tab takes too.
      const changed = await beforeSave(
        tab.path,
        tab.content,
        auto ? "auto" : "manual",
      );
      const content =
        changed === null
          ? tab.content
          : changed.inEditor
            ? (liveTabs().find((tb) => tb.id === tabId)?.content ?? tab.content)
            : changed.text;
      if (changed && !changed.inEditor) updateTab(tabId, { content });
      if (!(await writeOrReport(tab.path, content))) return "failed";
      await commitSaved(tabId, tab.path, content, auto);
      return "saved";
    },
    [liveTabs, updateTab, t, writeOrReport, commitSaved],
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
      updateTab(tabId, { path: moved });
      void notePathMoved(from, moved);
      void session.addRecentFile(moved);
    },
    [liveTabs, updateTab, suggestedName],
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
 * Lets onWillSave plugins change the text to save, put into the rendered
 * editor first as one undo step so what is saved is what shows. Null when
 * unchanged; `inEditor` false when no rendered editor took it.
 */
async function beforeSave(
  path: string,
  text: string,
  trigger: "manual" | "auto",
): Promise<{ text: string; inEditor: boolean } | null> {
  if (!hasWillSave()) return null;
  const changed = await runWillSave(path, text, trigger);
  if (changed === text) return null;
  const doc = openDocumentAt(path);
  return {
    text: changed,
    inEditor: !!doc?.replaceText(changed, doc.revision()),
  };
}

/** A picture's address in Markdown or HTML. */
const PICTURE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)|<img\b[^>]*\bsrc=["']([^"']+)/g;
const pictures = (text: string) =>
  [...text.matchAll(PICTURE)].map((m) => m[1] ?? m[2]);

/** `live` with each picture `before` had pointed where `after` points it:
 *  the addresses a save moved, applied to text typed since. */
export function movedPictures(before: string, after: string, live: string) {
  const from = pictures(before);
  const to = pictures(after);
  if (from.length !== to.length) return live;
  let out = live;
  from.forEach((src, i) => {
    if (src !== to[i]) out = out.split(src).join(to[i]);
  });
  return out;
}
