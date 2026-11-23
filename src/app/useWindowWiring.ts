import { canLinkSponsor } from "../platform/capabilities";
import { useEntriesFromOtherWindows } from "./useEntriesFromOtherWindows";
import { holdOnReturn } from "./hold-on-return";
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
import { useOpenPathsPush } from "./window-file-events";
import { useFileDrops } from "./file-drop/useFileDrops";
import { useSettingsCommands } from "./useSettingsCommands";
import { useCliRequests } from "./useCliRequests";
import { useDocumentActions } from "./useDocumentActions";
import {
  takeClosedPath,
  useClosePrompt,
  useWindowCloseGuard,
} from "./close-flow";
import {
  usePracticeNotes,
  usePracticeTabFront,
  useTutorialTabRecovery,
} from "./onboarding-wiring";
import type { WindowShell } from "./useWindowShell";
import type { WindowDocuments } from "./useWindowDocuments";
import type { Settings, useSettings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import { pageOf } from "./tabs/page-tabs";

/** The documents' scrollers: rendered, the split's preview, source. */
const DOCUMENT_SCROLLERS =
  ".main-pane :is(.editor-scroll, .split-preview, .source-view .cm-scroller)";

type WiringInput = {
  shell: WindowShell;
  docs: WindowDocuments;
  settings: Settings;
  setSettings: ReturnType<typeof useSettings>["setSettings"];
  t: Strings;
};

/** Settings commands, and the keys that run the actions a menu item runs
 *  too; those actions. */
function useKeysAndCommands(input: WiringInput) {
  const { shell, docs, settings, setSettings } = input;
  const { tabState, textusAi, panels } = shell;
  const { tabsRef, activeTabId, setActiveTabId } = tabState;
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
    showSidebarTab: panels.showSidebarTab,
  });
  return appActions;
}

/** Island numbers and back/forward among tabs; the tour's practice tab
 *  kept, and its notes. */
function useTabsAndTour(input: WiringInput) {
  const { shell, docs, settings } = input;
  const { tabState, tutorial } = shell;
  const { tabsRef, activeTabId, setActiveTabId } = tabState;
  useIslandNumbers(setActiveTabId);
  useNavHistory({ tabsRef, activeTabId, setActiveTabId });

  useTutorialTabRecovery(tutorial, tabState, docs.claimPracticeTab);
  usePracticeTabFront(tutorial, tabState);
  usePracticeNotes({
    tutorial,
    tabState,
    language: settings.language,
    evaluate: shell.evaluateTutorialDocumentChange,
  });
}

/** What opens at launch, and what is pushed to the window later: paths
 *  from the system and the command line, files dropped on it, and files
 *  from the sidebar dragged over the documents. */
function useWhatOpens(input: WiringInput) {
  const { shell, docs, settings, setSettings } = input;
  const { tabState, tutorial } = shell;
  const { activeTabId, setTabs } = tabState;
  const { activeTab, openFolder, openFile, openPathInTab } = docs;
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
  // Files dropped on the window, or dragged over the documents from the
  // sidebar: put in where they are let go, or opened there.
  useFileDrops({
    openFile,
    openPathInTab,
    openFolder: openFolder.openFolder,
    folder: openFolder.folder,
    t: input.t,
  });
}

/** Closing the window with unsaved work, files changed on disk, and the
 *  scroll held on the way back. */
function useWindowGuards(input: WiringInput) {
  const { shell, docs, settings } = input;
  const { tabState, setPendingClose } = shell;
  const { liveTabs } = tabState;
  useWindowCloseGuard(
    liveTabs,
    docs.flushAutosave,
    setPendingClose,
    settings.keepUnsavedOnClose && settings.enableDraftRecovery,
  );

  useExternalChangeReload(liveTabs, tabState.updateTab);
  useEffect(() => holdOnReturn(DOCUMENT_SCROLLERS), []);
}

/** What the app's own renames, moves and deletes do to open tabs, also
 *  those made in other windows. */
function useFollowingActions(input: WiringInput) {
  const { shell, docs } = input;
  const { tabState } = shell;
  const { openFile } = docs;
  const actions = useDocumentActions({
    tabState,
    openFile,
    removeTab: docs.removeTab,
    saveTab: docs.saveTab,
  });
  useEntriesFromOtherWindows(actions.followMove);
  return actions;
}

/** Which View items are on (the check marks in the app-drawn menu and in
 *  the macOS menu bar), and the menu's keys. */
function useNativeMenu(input: WiringInput) {
  const { shell, docs, settings } = input;
  const { textusAi, panels } = shell;
  const { activeTab, openFolder } = docs;
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
    formatBarSide: settings.formatBarSide,
    zen: docs.zenMode,
    readOnly: tabReadOnly(activeTab),
    folderOpen: openFolder.folder !== null,
    noDocument: pageOf(activeTab) !== null,
  };
  useNativeMenuChecks(menuChecks);
  useNativeMenuAccelerators(settings.shortcuts);
  return menuChecks;
}

/** The menu's items, wired to what they do. */
function useMenuBridgeFor(
  input: WiringInput,
  appActions: AppActionHandlers,
  actions: ReturnType<typeof useDocumentActions>,
) {
  const { shell, docs, settings, setSettings, t } = input;
  const { tabState, panels } = shell;
  const { activeTabId, liveTabs } = tabState;
  const { openFolder, openPathInTab } = docs;
  useMenuBridge({
    ...appActions,
    activeTabId,
    shortcuts: settings.shortcuts,
    liveTabs,
    t,
    pdfPageNumbers: settings.pdfPageNumbers,
    pdfLightColors: settings.pdfLightColors,
    pdfLayout: {
      paper: settings.pdfPaper,
      margin: settings.pdfMargin,
      textScale: settings.pdfTextScale,
    },
    diagramEngine: settings.diagramEngine,
    pandocSettings: settings,
    onOpenSettings: shell.settingsOpening.openSettings,
    onCheckUpdates: shell.settingsOpening.openUpdates,
    onOpenPluginSettings: shell.settingsOpening.openPluginSettings,
    onFormatBar: (side) =>
      setSettings(
        side ? { formatBar: true, formatBarSide: side } : { formatBar: false },
      ),
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
    openSponsor: () =>
      canLinkSponsor && void links.openSponsorPage(settings.language),
    onOpenDocuments: () => actions.setDocumentsOpen(true),
    shareActiveTab: actions.shareActiveTab,
  });
}

/** Everything that reaches a window from outside its own controls. */
export function useWindowWiring(input: WiringInput) {
  const appActions = useKeysAndCommands(input);
  useTabsAndTour(input);
  useWhatOpens(input);
  useWindowGuards(input);
  const actions = useFollowingActions(input);
  const menuChecks = useNativeMenu(input);
  useMenuBridgeFor(input, appActions, actions);
  const close = useClosePrompt({
    pendingClose: input.shell.pendingClose,
    setPendingClose: input.shell.setPendingClose,
    tabState: input.shell.tabState,
    cancelDraftFlushes: input.shell.cancelDraftFlushes,
    saveTab: input.docs.saveTab,
    removeTab: input.docs.removeTab,
  });

  return { ...actions, menuChecks, close };
}
