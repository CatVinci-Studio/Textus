import { canUseWindows } from "../platform/capabilities";
import { writingProviderOf } from "../prefs/settings-types";
import { openingDocuments, useProjectTabs } from "./start-project";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  registerNoteCompletion,
  setNoteCompletionRoot,
} from "../files/note-completion";
import {
  registerPathCompletion,
  setPathCompletionRoot,
} from "../files/path-completion";
import { useTabDragMerge } from "./tabs/useTabDragMerge";
import { useAutosave } from "../document/autosave";
import { useLastPlaces } from "../document/last-places";
import { useActiveDocument } from "./useActiveDocument";
import { useOpenFolder } from "./useOpenFolder";
import { useWindowSession } from "./islands/window-session";
import { useWindowTitle } from "./useWindowSession";
import { useFileOpening } from "./useFileOpening";
import { useHelpTabs } from "./useHelpTabs";
import { useSaveTabs } from "./useSaveTabs";
import { useDraftTitles } from "../ai/doc-title";
import { useZenMode } from "./useZenMode";
import { useSourceModes } from "./useSourceModes";
import { useTabRemoval } from "./close-flow";
import { folderTabsToClose } from "./close-folder";
import { readRecents } from "./menu/recents";
import { usePracticeTab } from "./onboarding-wiring";
import { usePluginWindow } from "./usePluginWindow";
import type { WindowShell } from "./useWindowShell";
import type { Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import { folderReopener } from "./folder-reopen";
import { useLatest } from "../utils/hooks/useLatest";

type Input = { shell: WindowShell; settings: Settings; t: Strings };
type Active = ReturnType<typeof useActiveDocument>;

/** The sidebar's folder in this window (Open Folder brings the Files tab
 *  into view), the search request, and what the window keeps. */
function useFolderAndSearch(input: Input, active: Active) {
  const { shell, t } = input;
  const { setPanelOpen, setPanelMode } = shell.panels;
  const { activeTab, documentsFolder, activeTitle } = active;
  const showFiles = useCallback(() => {
    setPanelOpen(true);
    setPanelMode("tree");
  }, [setPanelOpen, setPanelMode]);
  // Set by useFolderClosing, once the tabs can be closed.
  const replaceRef = useRef<(old: string | null, next: string) => void>(
    () => {},
  );
  const openFolder = useOpenFolder({
    activePath: activeTab.path,
    fallback: documentsFolder,
    onOpened: showFiles,
    onReplace: useCallback(
      (old: string | null, next: string) => replaceRef.current(old, next),
      [],
    ),
    folderTooBroad: t.folderTooBroad,
  });
  const search = useSearchRequest(
    setPanelOpen,
    setPanelMode,
    openFolder.treeRoot !== null,
  );
  useWindowKeeping(input, activeTitle, activeTab.path, openFolder.folder);
  return { openFolder, replaceRef, ...search };
}

/** The search shortcut's request, cleared by the box once it shows. */
function useSearchRequest(
  setPanelOpen: (open: boolean) => void,
  setPanelMode: (mode: "search") => void,
  hasTree: boolean,
) {
  const [searchFocusRequest, setSearchFocusRequest] = useState(false);
  const clearSearchFocusRequest = useCallback(
    () => setSearchFocusRequest(false),
    [],
  );
  const searchFiles = useCallback(() => {
    setPanelOpen(true);
    setPanelMode("search");
    // No tree yet: a request left standing would take the keyboard later.
    if (hasTree) setSearchFocusRequest(true);
  }, [setPanelOpen, setPanelMode, hasTree]);
  return { searchFocusRequest, clearSearchFocusRequest, searchFiles };
}

/** What the window keeps of itself: its title, its projects' tabs, its
 *  session, the places read in its documents. */
function useWindowKeeping(
  { shell, settings }: Input,
  activeTitle: string,
  activePath: string | null,
  folder: string | null,
) {
  const { tabs, setActiveTabId } = shell.tabState;
  useWindowTitle(activeTitle);
  useProjectTabs(
    folder,
    tabs.map((tab) => tab.path),
    activePath,
  );
  useWindowSession(tabs, folder, setActiveTabId);
  useLastPlaces(tabs, settings.restoreSessionOnStartup);
}

/** Opening files, `[[` listing the folder's notes while no plugin
 *  completes it, and the plugins' side of the window. */
function useOpening(
  { shell, settings, t }: Input,
  active: Active,
  folderRoot: string | null,
  later: {
    saveTab: (id: string) => Promise<boolean>;
    requestCloseTab: (id: string) => void;
  },
) {
  const { tabState } = shell;
  const { activeTab } = active;
  const dialogFilters = useMemo(
    () => ({
      textFilter: t.openDialogText,
      wordFilter: t.openDialogWord,
      allFilter: t.openDialogAll,
    }),
    [t],
  );
  const opening = useFileOpening({
    tabState,
    dialogFilters,
    restoreCarets: settings.restoreSessionOnStartup,
    t,
    onWordDocumentOpened: shell.wordImported.opened,
  });
  useEffect(() => {
    setNoteCompletionRoot(folderRoot);
    setPathCompletionRoot(folderRoot);
    const stopNotes = registerNoteCompletion(() => t.completionNotes);
    const stopPaths = registerPathCompletion({
      image: () => t.completionImages,
      link: () => t.completionFiles,
    });
    return () => {
      stopNotes();
      stopPaths();
    };
  }, [folderRoot, t]);
  usePluginWindow({
    t,
    language: settings.language,
    rootPath: folderRoot,
    activePath: activeTab.path,
    tabState,
    openPathInTab: opening.openPathInTab,
    openFile: opening.openFile,
    // Read when a plugin asks.
    saveActiveTab: () => later.saveTab(activeTab.id),
    saveTab: (id) => later.saveTab(id),
    closeActiveTab: () => later.requestCloseTab(activeTab.id),
  });
  return opening;
}

/** Help tabs, the tour's practice tab, and the document's text as it is
 *  typed (a preview tab written in is kept; the tour watches it). */
function useHelpAndTyping({ shell, settings }: Input) {
  const { tabState, tutorial, evaluateTutorialDocumentChange } = shell;
  const { setTabs } = tabState;
  const { openHelpTab } = useHelpTabs({
    tabState,
    language: settings.language,
    stopTutorial: tutorial.exit,
  });
  const { claimPracticeTab, startWelcomeTutorial } = usePracticeTab(
    tabState,
    tutorial.start,
  );
  const handleChange = useCallback(
    (tabId: string, markdown: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id !== tabId
            ? tab
            : {
                ...tab,
                content: markdown,
                ...(tab.preview && markdown !== tab.savedContent
                  ? { preview: false }
                  : {}),
              },
        ),
      );
      evaluateTutorialDocumentChange(tabId, markdown);
    },
    [setTabs, evaluateTutorialDocumentChange],
  );
  return { openHelpTab, claimPracticeTab, startWelcomeTutorial, handleChange };
}

/** Saving: Save and Save As, the AI's names for drafts, autosave. */
function useSaving({ shell, settings, t }: Input, folder: string | null) {
  const { tabState, tutorial } = shell;
  const { tabs, activeTabId } = tabState;
  const aiTitleFor = useDraftTitles(
    tabs,
    settings.textusAi && settings.autoSuggestFilename
      ? writingProviderOf(settings)
      : null,
    settings.writingModels[writingProviderOf(settings)] || null,
  );
  const saving = useSaveTabs({
    tabState,
    t,
    autoSuggestFilename: settings.autoSuggestFilename,
    imageFolder: settings.imageFolder,
    folder,
    aiTitleFor,
  });
  const flushAutosave = useAutosave({
    tabs,
    tabsRef: tabState.tabsRef,
    activeTabId,
    enabled: settings.autosave,
    untitledToFile: folder !== null,
    practiceTabId: tutorial.active ? tutorial.tabId : null,
    autosaveTab: saving.autosaveTab,
  });
  return { saving, flushAutosave };
}

/** Zen, and each tab's source mode. */
function useViewModes(tabState: WindowShell["tabState"]) {
  const zen = useZenMode();
  const modes = useSourceModes(tabState);
  return { zen, modes };
}

/** Closing tabs, and folders: Close Folder also closes the folder's saved
 *  documents (with none left, the start page); another folder opened here
 *  takes the old one's place, as an editor's workspace does: its saved
 *  documents close, and the new one's come back as it was left
 *  (start-project.ts), in this window, whatever else it holds - not as
 *  Open Recent, which hands a busy window's files to the windows. */
function useFolderClosing(
  { shell, settings, t }: Input,
  {
    openFolder,
    flushAutosave,
    openPathInTab,
  }: {
    openFolder: ReturnType<typeof useOpenFolder>;
    flushAutosave: ReturnType<typeof useAutosave>;
    openPathInTab: ReturnType<typeof useFileOpening>["openPathInTab"];
  },
) {
  const { tabState, setPendingClose } = shell;
  const { liveTabs, addStartTab } = tabState;
  const { removeTab, requestCloseTab } = useTabRemoval({
    tabState,
    cancelDraftFlushes: shell.cancelDraftFlushes,
    flushAutosave,
    setPendingClose,
    closeLastToStartPage: settings.closeLastToStartPage,
    t,
  });
  const { folder, closeFolder: forgetFolder } = openFolder;
  const closeTabsOf = useCallback(
    (old: string) => {
      const { close, blank } = folderTabsToClose(liveTabs(), old);
      if (blank) addStartTab();
      for (const id of close) removeTab(id);
    },
    [liveTabs, addStartTab, removeTab],
  );
  const closeFolder = useCallback(() => {
    forgetFolder();
    if (folder) closeTabsOf(folder);
  }, [folder, forgetFolder, closeTabsOf]);
  const openLatest = useLatest(openPathInTab);
  const [reopenFolder] = useState(() =>
    folderReopener(
      async (folder) => openingDocuments(folder, (await readRecents()).files),
      (path) => openLatest.current(path, { restoreCaret: true }),
    ),
  );
  const replaceFolder = (old: string | null, next: string) => {
    if (old) closeTabsOf(old);
    void reopenFolder(next);
  };
  return { removeTab, requestCloseTab, closeFolder, replaceFolder };
}

/**
 * A window's documents: the active one, the sidebar folder, opening,
 * saving, closing, view modes and tabs moving between windows.
 */
export function useWindowDocuments(input: Input) {
  const { shell, settings, t } = input;
  const { tabState } = shell;
  const { tabs, setTabs, activeTabId, setActiveTabId, tabsRef, liveTabs } =
    tabState;
  const active = useActiveDocument(tabs, activeTabId, t);
  const { openFolder, replaceRef, ...search } = useFolderAndSearch(
    input,
    active,
  );
  const opening = useOpening(
    input,
    active,
    openFolder.folder ?? openFolder.treeRoot,
    {
      // Defined below; read when a plugin asks.
      saveTab: (id) => saving.saveTab(id),
      requestCloseTab: (id) => requestCloseTab(id),
    },
  );
  const help = useHelpAndTyping(input);
  const { saving, flushAutosave } = useSaving(input, openFolder.folder);
  const { zen, modes } = useViewModes(tabState);
  const { removeTab, requestCloseTab, closeFolder, replaceFolder } =
    useFolderClosing(input, {
      openFolder,
      flushAutosave,
      openPathInTab: opening.openPathInTab,
    });
  replaceRef.current = replaceFolder;

  // Tabs moving between windows, in both directions.
  const { dragHoverPreview, handleTabDetach, moveTabToNewWindow } =
    useTabDragMerge({
      tabsRef,
      liveTabs,
      t,
      removeTab,
      setTabs,
      setActiveTabId,
    });

  // The tabs always show, + beside the one tab; in Zen, or with the title
  // on a row of its own, one document is a clean sheet under its title,
  // until there are several or a tab comes in.
  const oneSheet = zen.zenMode || (canUseWindows && settings.titleRowShown);
  const showTabBar = !oneSheet || tabs.length > 1 || dragHoverPreview !== null;

  return {
    ...active,
    openFolder: { ...openFolder, closeFolder },
    ...search,
    ...opening,
    ...help,
    ...saving,
    flushAutosave,
    ...zen,
    ...modes,
    removeTab,
    requestCloseTab,
    dragHoverPreview,
    handleTabDetach,
    moveTabToNewWindow,
    showTabBar,
  };
}

export type WindowDocuments = ReturnType<typeof useWindowDocuments>;
