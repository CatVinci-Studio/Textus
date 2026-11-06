import { useCallback, useEffect, useMemo, useState } from "react";
import {
  registerNoteCompletion,
  setNoteCompletionRoot,
} from "../sidebar/note-completion";
import { useTabDragMerge } from "./tabs/useTabDragMerge";
import { useAutosave } from "../document/autosave";
import { useLastCarets } from "../document/last-carets";
import { useActiveDocument } from "./useActiveDocument";
import { useOpenFolder } from "./useOpenFolder";
import { useSplitRestore } from "./split/split-restore";
import { useSessionPaths, useWindowTitle } from "./useWindowSession";
import { useFileOpening } from "./useFileOpening";
import { useHelpTabs } from "./useHelpTabs";
import { useSaveTabs } from "./useSaveTabs";
import { useDraftTitles } from "../ai/doc-title";
import { useZenMode } from "./useZenMode";
import { useSourceModes } from "./useSourceModes";
import { useTabRemoval } from "./close-flow";
import { folderTabsToClose } from "./close-folder";
import { usePracticeTab } from "./onboarding-wiring";
import { usePluginWindow } from "../plugins/usePluginWindow";
import type { WindowShell } from "./useWindowShell";
import type { Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";

/**
 * A window's documents: the active one, the sidebar folder, opening,
 * saving, closing, view modes and tabs moving between windows.
 */
export function useWindowDocuments({
  shell,
  settings,
  t,
}: {
  shell: WindowShell;
  settings: Settings;
  t: Strings;
}) {
  const { tabState, panels, tutorial, setPendingClose } = shell;
  const { tabs, setTabs, activeTabId, setActiveTabId, tabsRef, liveTabs } =
    tabState;
  const { setPanelOpen, setPanelMode } = panels;
  const active = useActiveDocument(tabs, activeTabId, t);
  const { activeTab, documentsFolder, activeTitle } = active;
  const showFiles = useCallback(() => {
    setPanelOpen(true);
    setPanelMode("tree");
  }, [setPanelOpen, setPanelMode]);
  const openFolder = useOpenFolder({
    activePath: activeTab.path,
    fallback: documentsFolder,
    onOpened: showFiles,
    folderTooBroad: t.folderTooBroad,
  });
  // The search shortcut's request, cleared by the box once it shows.
  const [searchFocusRequest, setSearchFocusRequest] = useState(false);
  const clearSearchFocusRequest = useCallback(
    () => setSearchFocusRequest(false),
    [],
  );
  const hasTree = openFolder.treeRoot !== null;
  const searchFiles = useCallback(() => {
    showFiles();
    // No tree yet: a request left standing would take the keyboard later.
    if (hasTree) setSearchFocusRequest(true);
  }, [showFiles, hasTree]);
  useWindowTitle(activeTitle);
  useSessionPaths(tabs);
  useSplitRestore(tabs, setActiveTabId);

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
  useLastCarets(tabs, activeTabId, settings.restoreSessionOnStartup);
  const folderRoot = openFolder.folder ?? openFolder.treeRoot;
  // `[[` lists the folder's notes while no plugin completes it.
  useEffect(() => {
    setNoteCompletionRoot(folderRoot);
    return registerNoteCompletion(() => t.completionNotes);
  }, [folderRoot, t]);
  usePluginWindow({
    t,
    language: settings.language,
    rootPath: folderRoot,
    activePath: activeTab.path,
    tabState,
    openPathInTab: opening.openPathInTab,
    // Defined below; read when a plugin asks.
    saveActiveTab: () => saving.saveTab(activeTab.id),
    closeActiveTab: () => requestCloseTab(activeTab.id),
  });

  const { openHelpTab } = useHelpTabs({
    tabState,
    language: settings.language,
    stopTutorial: tutorial.exit,
  });

  const { claimPracticeTab, startWelcomeTutorial } = usePracticeTab(
    tabState,
    tutorial.start,
  );

  const { updateTab } = tabState;
  const { evaluateTutorialDocumentChange } = shell;
  const handleChange = useCallback(
    (tabId: string, markdown: string) => {
      updateTab(tabId, { content: markdown });
      evaluateTutorialDocumentChange(tabId, markdown);
    },
    [updateTab, evaluateTutorialDocumentChange],
  );

  const aiTitleFor = useDraftTitles(
    tabs,
    settings.textusAi && settings.autoSuggestFilename
      ? settings.aiProvider
      : null,
    settings.writingModels[settings.aiProvider] || null,
  );
  const saving = useSaveTabs({
    tabState,
    t,
    autoSuggestFilename: settings.autoSuggestFilename,
    imageFolder: settings.imageFolder,
    folder: openFolder.folder,
    aiTitleFor,
  });
  const flushAutosave = useAutosave({
    tabs,
    activeTabId,
    enabled: settings.autosave,
    untitledToFile: openFolder.folder !== null,
    practiceTabId: tutorial.active ? tutorial.tabId : null,
    autosaveTab: saving.autosaveTab,
  });

  const zen = useZenMode();
  const modes = useSourceModes(tabState);

  const { removeTab, requestCloseTab } = useTabRemoval({
    tabState,
    cancelDraftFlushes: shell.cancelDraftFlushes,
    flushAutosave,
    setPendingClose,
    t,
  });

  // Close Folder also closes the folder's saved documents.
  const { folder, closeFolder: forgetFolder } = openFolder;
  const { addBlankTab } = tabState;
  const closeFolder = useCallback(() => {
    forgetFolder();
    if (!folder) return;
    const { close, blank } = folderTabsToClose(liveTabs(), folder);
    if (blank) addBlankTab();
    for (const id of close) removeTab(id);
  }, [folder, forgetFolder, liveTabs, addBlankTab, removeTab]);

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

  // The bar shows only with several tabs, or when an incoming tab's preview
  // needs somewhere to land.
  const showTabBar = tabs.length > 1 || dragHoverPreview !== null;

  return {
    ...active,
    openFolder: { ...openFolder, closeFolder },
    searchFocusRequest,
    clearSearchFocusRequest,
    searchFiles,
    ...opening,
    openHelpTab,
    claimPracticeTab,
    startWelcomeTutorial,
    handleChange,
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
