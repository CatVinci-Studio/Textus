import { useEntriesFromOtherWindows } from "./useEntriesFromOtherWindows";
import { linkToFile } from "./islands/link-to-file";
import { useHoldScrollOnReturn } from "../document-view/hold-scroll-on-return";
import { useEffect } from "react";
import { links } from "../platform/ipc";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import type { AppActionHandlers } from "./menu/app-actions";
import { useIslandNumbers } from "./islands/useIslandNumbers";
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
import { useCliRequests } from "./useCliRequests";
import { useDocumentActions } from "./useDocumentActions";
import {
  takeClosedPath,
  useClosePrompt,
  useWindowCloseGuard,
} from "./close-flow";
import { usePracticeNotes, useTutorialTabRecovery } from "./onboarding-wiring";
import { setDocumentDrop } from "../engine/controls/document-drop";
import { fileDropOnDocuments } from "./islands/split-drop";
import type { WindowShell } from "./useWindowShell";
import type { WindowDocuments } from "./useWindowDocuments";
import type { Settings, useSettings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import { tabInUse } from "../engine/layout/store";

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
  // What the actions a key and a menu item both run work with.
  const appActions: AppActionHandlers = {
    onToggleSidebar: panels.toggleSidebar,
    onToggleAgentPanel: panels.toggleAgentPanel,
    onToggleSplitView: docs.toggleSplitView,
    onToggleZenMode: docs.toggleZenMode,
    onToggleTextusAi: textusAi.toggle,
    onToggleTypewriter: () =>
      setSettings({ typewriterMode: !settings.typewriterMode }),
    toggleSourceMode: docs.toggleSourceMode,
  };
  useGlobalShortcuts({
    tabsRef,
    activeTabId,
    setActiveTabId,
    saveTab: docs.saveTab,
    requestCloseTab: docs.requestCloseTab,
    actions: appActions,
    searchFiles: docs.searchFiles,
  });

  useIslandNumbers(setActiveTabId);
  useNavHistory({ tabsRef, activeTabId, setActiveTabId });

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
    language: settings.language,
    onboardingShown: settings.onboardingShown,
    setTabs,
    setDraftsRestoredCount: shell.setDraftsRestoredCount,
    markOnboardingShown: () => setSettings({ onboardingShown: true }),
    openPathInTab,
    tabsForPaths: docs.tabsForPaths,
    openFile,
    replaceTabWithFile: docs.replaceTabWithFile,
    restoreCarets: settings.restoreSessionOnStartup,
    launchStartPage:
      settings.startPageOnLaunch && !settings.restoreSessionOnStartup,
    startTutorial: tutorial.start,
    stopTutorial: tutorial.exit,
  });

  // The same, pushed to an already-running window.
  useOpenPathsPush(openPathInTab);
  useCliRequests({
    openPath: openPathInTab,
    activePath: activeTab.path,
    settings,
    setSettings,
  });
  useFileDrop(openFile, openPathInTab, openFolder.openFolder);
  // A file from the sidebar dragged over the documents opens where it is
  // let go.
  useEffect(() => {
    setDocumentDrop(
      fileDropOnDocuments((path, drop) => void openPathInTab(path, { drop }), {
        // With Shift: a link to it in the document in use (one never
        // saved has no place to link from: it opens instead).
        link: (path) => {
          const from = liveTabs().find((tab) => tab.id === tabInUse())?.path;
          if (from) void linkToFile(path, from, openFolder.folder);
          else void openPathInTab(path);
        },
      }),
    );
    return () => setDocumentDrop(null);
  }, [openPathInTab, liveTabs, openFolder.folder]);

  useWindowCloseGuard(
    liveTabs,
    docs.flushAutosave,
    setPendingClose,
    settings.keepUnsavedOnClose && settings.enableDraftRecovery,
  );

  useExternalChangeReload(liveTabs, tabState.updateTab);
  useHoldScrollOnReturn();

  const actions = useDocumentActions({
    tabState,
    openFile,
    removeTab: docs.removeTab,
    saveTab: docs.saveTab,
  });
  useEntriesFromOtherWindows(actions.followMove);

  // Which View items are on: the check marks in the app-drawn menu and in
  // the macOS menu bar.
  const menuChecks = {
    sidebar: panels.panelOpen,
    agentPanel: panels.agentPanel.open,
    textusAi: textusAi.on,
    sourceMode: !!activeTab.sourceMode && !activeTab.splitView,
    splitView: !!activeTab.sourceMode && !!activeTab.splitView,
    typewriter: settings.typewriterMode,
    formatBar: settings.formatBar,
    zen: docs.zenMode,
    readOnly: tabReadOnly(activeTab),
    folderOpen: openFolder.folder !== null,
  };
  useNativeMenuChecks(menuChecks);
  useNativeMenuAccelerators(settings.shortcuts);

  useMenuBridge({
    ...appActions,
    activeTabId,
    shortcuts: settings.shortcuts,
    liveTabs,
    t,
    pdfPageNumbers: settings.pdfPageNumbers,
    pdfLightColors: settings.pdfLightColors,
    diagramEngine: settings.diagramEngine,
    pandocSettings: settings,
    onOpenSettings: shell.settingsOpening.openSettings,
    onCheckUpdates: shell.settingsOpening.openUpdates,
    onOpenPluginSettings: shell.settingsOpening.openPluginSettings,
    onToggleFormatBar: () => setSettings({ formatBar: !settings.formatBar }),
    showSidebarTab: (id: string) => {
      panels.setPanelMode(id);
      panels.setPanelOpen(true);
    },
    onOpenAgentPanel: () => {
      if (!panels.agentPanel.open) panels.toggleAgentPanel();
    },
    onToggleReadOnly: () => docs.chooseViewMode("read-only"),
    onViewModeDefault: () => docs.chooseViewMode("default"),
    addBlankTab: tabState.addBlankTab,
    openFileDialog: docs.openFileDialog,
    openRecentFile: docs.openRecentFile,
    openFolderDialog: openFolder.openFolderDialog,
    openFolder: openFolder.openFolder,
    closeFolder: openFolder.closeFolder,
    saveTab: docs.saveTab,
    saveTabAs: docs.saveTabAs,
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
    openSponsor: () => void links.openSponsorPage(settings.language),
    onOpenDocuments: () => actions.setDocumentsOpen(true),
    shareActiveTab: actions.shareActiveTab,
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
