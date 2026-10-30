import { useCallback, useMemo, useState } from "react";
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
import { useZenMode } from "./useZenMode";
import { useSourceModes } from "./useSourceModes";
import { useTabRemoval } from "./close-flow";
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
  usePluginWindow({
    t,
    language: settings.language,
    rootPath: openFolder.folder ?? openFolder.treeRoot,
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

  const saving = useSaveTabs({
    tabState,
    t,
    autoSuggestFilename: settings.autoSuggestFilename,
    imageFolder: settings.imageFolder,
  });
  const flushAutosave = useAutosave({
    tabs,
    activeTabId,
    enabled: settings.autosave,
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
    openFolder,
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
