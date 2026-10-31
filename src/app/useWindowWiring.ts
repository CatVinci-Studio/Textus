import { useEffect } from "react";
import { setReadOnlyShown } from "../document/read-only-state";
import { installClipboardCapture } from "../clipboard/history";
import { links } from "../platform/ipc";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useNavHistory } from "./useNavHistory";
import { useExternalChangeReload } from "../document/useExternalChangeReload";
import { tabReadOnly } from "../document/read-only";
import {
  useMenuBridge,
  useNativeMenuAccelerators,
  useNativeMenuChecks,
} from "./menu/menu-bridge";
import { useStartupRestore } from "../document/startup-restore";
import { useOpenPathsPush, useFileDrop } from "./useFileOpening";
import { useSettingsCommands } from "./useSettingsCommands";
import { useDocumentActions } from "./useDocumentActions";
import {
  takeClosedPath,
  useClosePrompt,
  useWindowCloseGuard,
} from "./close-flow";
import {
  usePracticeNotes,
  useTutorialTabRecovery,
  useWriteLesson,
} from "./onboarding-wiring";
import { setDocumentDrop } from "../ui/document-drop";
import { fileDropOnDocuments } from "./split/split-drop";
import type { WindowShell } from "./useWindowShell";
import type { WindowDocuments } from "./useWindowDocuments";
import type { Settings, useSettings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";

/** Everything that reaches a window from outside its own controls. */
export function useWindowWiring({
  shell,
  docs,
  settings,
  setSettings,
  t,
}: {
  shell: WindowShell;
  docs: WindowDocuments;
  settings: Settings;
  setSettings: ReturnType<typeof useSettings>["setSettings"];
  t: Strings;
}) {
  const { tabState, tutorial, textusAi, panels, setPendingClose } = shell;
  const { tabsRef, activeTabId, setActiveTabId, setTabs, liveTabs } = tabState;
  const { activeTab, openFolder, openFile, openPathInTab } = docs;

  useSettingsCommands(settings, setSettings);
  useGlobalShortcuts({
    tabsRef,
    activeTabId,
    setActiveTabId,
    saveTab: docs.saveTab,
    requestCloseTab: docs.requestCloseTab,
    toggleSourceMode: docs.toggleSourceMode,
    toggleSidebar: panels.toggleSidebar,
    toggleAgentPanel: panels.toggleAgentPanel,
    toggleSplitView: docs.toggleSplitView,
    toggleZenMode: docs.toggleZenMode,
    searchFiles: docs.searchFiles,
    toggleTextusAi: textusAi.toggle,
  });

  useNavHistory({ tabsRef, activeTabId, setActiveTabId });
  useEffect(() => installClipboardCapture(), []);

  useTutorialTabRecovery(tutorial, tabState, docs.claimPracticeTab);
  usePracticeNotes({
    tutorial,
    tabState,
    language: settings.language,
    evaluate: shell.evaluateTutorialDocumentChange,
  });

  // What opens at launch (OS-opened files, recovered drafts, a dragged-in
  // tab, a Help doc). Runs only once, at mount.
  useStartupRestore({
    activeTabId,
    enableDraftRecovery: settings.enableDraftRecovery,
    newDocumentMode: settings.newDocumentMode,
    language: settings.language,
    onboardingShown: settings.onboardingShown,
    setTabs,
    setDraftsRestoredCount: shell.setDraftsRestoredCount,
    markOnboardingShown: () => setSettings({ onboardingShown: true }),
    openPathInTab,
    openFile,
    replaceTabWithFile: docs.replaceTabWithFile,
    restoreCarets: settings.restoreSessionOnStartup,
    startTutorial: tutorial.start,
    stopTutorial: tutorial.exit,
  });

  // The same, pushed to an already-running window.
  useOpenPathsPush(openPathInTab);
  useFileDrop(openFile, openPathInTab, openFolder.openFolder);
  // A file from the sidebar dragged over the documents opens where it is
  // let go.
  useEffect(() => {
    setDocumentDrop(
      fileDropOnDocuments((path, drop) => void openPathInTab(path, { drop })),
    );
    return () => setDocumentDrop(null);
  }, [openPathInTab]);

  useWindowCloseGuard(
    liveTabs,
    docs.flushAutosave,
    setPendingClose,
    settings.keepUnsavedOnClose && settings.enableDraftRecovery,
  );

  useExternalChangeReload(liveTabs, tabState.updateTab);

  const actions = useDocumentActions({
    tabState,
    openFile,
    removeTab: docs.removeTab,
    saveTab: docs.saveTab,
  });

  // Which View items are on: the check marks in the app-drawn menu and in
  // the macOS menu bar.
  const menuChecks = {
    sidebar: panels.panelOpen,
    agentPanel: panels.agentPanel.open,
    textusAi: textusAi.on,
    sourceMode: !!activeTab.sourceMode && !activeTab.splitView,
    splitView: !!activeTab.sourceMode && !!activeTab.splitView,
    typewriter: settings.typewriterMode,
    zen: docs.zenMode,
    readOnly: tabReadOnly(activeTab),
    folderOpen: openFolder.folder !== null,
  };
  useNativeMenuChecks(menuChecks);
  useEffect(() => setReadOnlyShown(menuChecks.readOnly), [menuChecks.readOnly]);
  useNativeMenuAccelerators(settings.shortcuts);

  useMenuBridge({
    activeTabId,
    liveTabs,
    t,
    pdfPageNumbers: settings.pdfPageNumbers,
    pdfLightColors: settings.pdfLightColors,
    diagramEngine: settings.diagramEngine,
    onOpenSettings: shell.settingsOpening.openSettings,
    onCheckUpdates: shell.settingsOpening.openUpdates,
    onOpenPluginSettings: shell.settingsOpening.openPluginSettings,
    onToggleTypewriter: () =>
      setSettings({ typewriterMode: !settings.typewriterMode }),
    onToggleSidebar: panels.toggleSidebar,
    onToggleAgentPanel: panels.toggleAgentPanel,
    onToggleTextusAi: textusAi.toggle,
    onToggleSplitView: docs.toggleSplitView,
    onToggleReadOnly: () => docs.toggleReadOnly(),
    onToggleZenMode: docs.toggleZenMode,
    addBlankTab: tabState.addBlankTab,
    openFileDialog: docs.openFileDialog,
    openRecentFile: docs.openRecentFile,
    openFolderDialog: openFolder.openFolderDialog,
    openFolder: openFolder.openFolder,
    closeFolder: openFolder.closeFolder,
    saveTab: docs.saveTab,
    saveTabAs: docs.saveTabAs,
    toggleSourceMode: docs.toggleSourceMode,
    requestCloseTab: docs.requestCloseTab,
    reopenClosedTab: () => {
      const path = takeClosedPath((p) =>
        liveTabs().some((tb) => tb.path === p),
      );
      if (path) void openPathInTab(path, { restoreCaret: true });
    },
    openHelpTab: docs.openHelpTab,
    startWelcomeTutorial: docs.startWelcomeTutorial,
    openCommunity: () => void links.openCommunityPage(settings.language),
    openTutorials: () => void links.openTutorialsPage(settings.language),
    onOpenDocuments: () => actions.setDocumentsOpen(true),
    shareActiveTab: actions.shareActiveTab,
  });

  useWriteLesson({
    tutorial,
    languageChosen: settings.languageChosen,
    agentPanelOpen: panels.agentPanel.open,
  });

  const close = useClosePrompt({
    pendingClose: shell.pendingClose,
    setPendingClose,
    tabState,
    cancelDraftFlushes: shell.cancelDraftFlushes,
    saveTab: docs.saveTab,
    removeTab: docs.removeTab,
  });

  return { ...actions, menuChecks, close };
}
