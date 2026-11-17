import { useCallback } from "react";
import { useFileWrites, useSaveToPath } from "./useSaveWrites";
import {
  useAutoNamed,
  useAutosaveTab,
  useOneSavePerTab,
} from "./useAutosaveTab";
import { showMessage } from "../engine/controls/app-dialog";
import { basename, parentDir } from "../utils/path";
import { tabTitle, type DocTab } from "../document/doc-tabs";
import { fs } from "../platform/ipc";
import {
  defaultMarkdownFilename,
  markdownFilename,
} from "../document/save-default-name";
import { isWordDocument, wordSaveSuggestion } from "../document/word-import";
import type { Strings } from "../i18n/strings";
import type { TabState } from "./tabs/useTabState";
import { getUiState, setUiState } from "../storage/ui-state";

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
  const { liveTabs } = tabState;

  const { writeOrReport, adoptFile } = useFileWrites({
    tabState,
    t,
    imageFolder,
  });

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

  const autoNamed = useAutoNamed();

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
      autoNamed.forget(tabId);
      return adoptFile(tab, picked, false);
    },
    [liveTabs, t, suggestedName, adoptFile, folder, autoNamed],
  );

  const serialized = useOneSavePerTab();
  const saveToPath = useSaveToPath({
    tabState,
    t,
    writeOrReport,
    serialized,
  });

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

  const autosaveTab = useAutosaveTab({
    tabState,
    folder,
    suggestedName,
    adoptFile,
    saveToPath,
    serialized,
    autoNamed,
  });

  return { saveTab, saveTabAs, autosaveTab };
}
