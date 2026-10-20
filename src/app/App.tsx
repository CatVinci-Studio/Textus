import { useCallback, useEffect, useMemo, useState } from "react";
import { AppDialogHost } from "../ui/app-dialog";
import { WindowBar } from "./WindowBar";
import { installClipboardCapture } from "../clipboard/history";
import { isIOSApp } from "../platform/capabilities";
import { SettingsPanel } from "../settings/SettingsPanel";
import { DocumentList } from "../mobile/DocumentList";
import { KeyboardToolbar } from "../mobile/KeyboardToolbar";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { useSettings } from "../settings/SettingsContext";
import { links } from "../platform/ipc";
import { useTutorial } from "../onboarding/useTutorial";
import { useTutorialDocumentEvaluation } from "../onboarding/useTutorialDocumentEvaluation";
import { formatCombo } from "../utils/shortcuts";
import { useAppUpdate } from "./useAppUpdate";
import { useZoom } from "./useZoom";
import { useTabDragMerge } from "./useTabDragMerge";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { fixedShortcutGroups } from "./fixed-shortcuts";
import { platformName } from "../platform/window-chrome";
import { useExternalChangeReload } from "../document/useExternalChangeReload";
import { useDraftAutosave } from "../document/draft-autosave";
import { useAutosave } from "../document/autosave";
import { useMenuBridge, useNativeMenuChecks } from "./menu-bridge";
import { useStartupRestore } from "../document/startup-restore";
import { useLastCarets } from "../document/last-carets";
import { Presence } from "../ui/usePresence";
import { FlipOnChange } from "../ui/flip";
import { AgentPanelProvider } from "../ai/chat/panel/agent-panel";
import { useTabState } from "./useTabState";
import { useSidePanels } from "./useSidePanels";
import { useActiveDocument } from "./useActiveDocument";
import { useOpenFolder } from "./useOpenFolder";
import { useSessionPaths, useWindowTitle } from "./useWindowSession";
import {
  useFileDrop,
  useFileOpening,
  useOpenPathsPush,
} from "./useFileOpening";
import { useHelpTabs } from "./useHelpTabs";
import { useSaveTabs } from "./useSaveTabs";
import { useZenMode } from "./useZenMode";
import { useSourceModes } from "./useSourceModes";
import { useDocumentActions } from "./useDocumentActions";
import {
  useClosePrompt,
  useTabRemoval,
  useWindowCloseGuard,
  type PendingClose,
} from "./close-flow";
import {
  useLevisOffer,
  usePracticeTab,
  usePracticeNotes,
  useTutorialTabRecovery,
  useWindowLessons,
} from "./onboarding-wiring";
import { Sidebar } from "./Sidebar";
import { MainPane } from "./MainPane";
import { AgentPanelDock } from "./AgentPanelDock";
import { ClosePrompt } from "./ClosePrompt";
import {
  DraftRestoredToast,
  UpdateToast,
  WordImportNotice,
  ZenHint,
} from "./AppNotices";
import { OnboardingLayers } from "./OnboardingLayers";
import "./App.css";

/**
 * One window: its tabs, the panels around them, and the prompts and
 * notices over them. Each concern lives in its own hook or component in
 * this folder; this is where they meet. The hooks keep the order they had
 * when all of this was one function, so their effects still run in it.
 */
function App() {
  const { t, settings, setSettings } = useSettings();
  const levisOffer = useLevisOffer({
    t,
    settings,
    setSettings,
    exitTutorial: () => tutorial.exit(),
  });
  const tabState = useTabState();
  const { tabs, setTabs, activeTabId, setActiveTabId, tabsRef, liveTabs } =
    tabState;
  const { updateTab, reorderTab, addBlankTab } = tabState;
  // The one save/discard/cancel prompt (close-flow.ts's PendingClose).
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const {
    panelOpen,
    setPanelOpen,
    toggleSidebar,
    sidebarWidth,
    agentPanel,
    agentOverlays,
    agentPanelEl,
    setAgentPanelEl,
    toggleAgentPanel,
    sidebarPresence,
    sidebarClosing,
    agentPresence,
    agentClosing,
    sheetFull,
    setSheetFull,
    panelMode,
    setPanelMode,
  } = useSidePanels();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const appUpdate = useAppUpdate(settings.updateChannel);
  useZoom(settings.zoom, (zoom) => setSettings({ zoom }));
  const tutorial = useTutorial();
  const startTutorial = tutorial.start;
  const stopTutorial = tutorial.exit;
  const evaluateTutorialDocumentChange = useTutorialDocumentEvaluation(
    tutorial,
    settings.language,
  );
  const cancelDraftFlushes = useDraftAutosave(
    tabs,
    settings.enableDraftRecovery,
  );
  const [draftsRestoredCount, setDraftsRestoredCount] = useState(0);
  // The Word document last opened as a new one, for its notice.
  const [wordImported, setWordImported] = useState<string | null>(null);
  const dismissWordImported = useCallback(() => setWordImported(null), []);

  const {
    activeTab,
    documentsFolder,
    wordCount,
    isLargeDoc,
    activeDirty,
    activeTitle,
  } = useActiveDocument(tabs, activeTabId, t);
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
  // The search shortcut's request for the Files tab's search box, taken
  // (and cleared) by the box once the sidebar shows it.
  const [searchFocusRequest, setSearchFocusRequest] = useState(false);
  const clearSearchFocusRequest = useCallback(
    () => setSearchFocusRequest(false),
    [],
  );
  const hasTree = openFolder.treeRoot !== null;
  const searchFiles = useCallback(() => {
    showFiles();
    // No tree yet (an unsaved draft): nothing to search, and a request
    // left standing would take the keyboard whenever a tree came.
    if (hasTree) setSearchFocusRequest(true);
  }, [showFiles, hasTree]);
  useWindowTitle(activeTitle);
  useSessionPaths(tabs);

  const dialogFilters = useMemo(
    () => ({
      textFilter: t.openDialogText,
      wordFilter: t.openDialogWord,
      allFilter: t.openDialogAll,
    }),
    [t],
  );
  const {
    openPathInTab,
    replaceTabWithFile,
    openFile,
    openFileDialog,
    openRecentFile,
  } = useFileOpening({
    tabState,
    newDocumentMode: settings.newDocumentMode,
    setPendingClose,
    dialogFilters,
    restoreCarets: settings.restoreSessionOnStartup,
    t,
    onWordDocumentOpened: setWordImported,
  });
  useLastCarets(tabs, activeTabId, settings.restoreSessionOnStartup);

  const { openHelpTab } = useHelpTabs({
    tabState,
    language: settings.language,
    stopTutorial,
  });

  const { claimPracticeTab, startWelcomeTutorial } = usePracticeTab(
    tabState,
    startTutorial,
  );

  const handleChange = useCallback(
    (tabId: string, markdown: string) => {
      updateTab(tabId, { content: markdown });
      evaluateTutorialDocumentChange(tabId, markdown);
    },
    [updateTab, evaluateTutorialDocumentChange],
  );

  const { saveTab, saveTabAs, autosaveTab } = useSaveTabs({
    tabState,
    t,
    autoSuggestFilename: settings.autoSuggestFilename,
    imageFolder: settings.imageFolder,
  });
  const flushAutosave = useAutosave({
    tabs,
    activeTabId,
    enabled: settings.autosave,
    autosaveTab,
  });

  const { zenMode, setZenMode, toggleZenMode } = useZenMode();
  const { toggleSourceMode, toggleSplitView } = useSourceModes(tabState);

  const { removeTab, requestCloseTab } = useTabRemoval({
    tabState,
    cancelDraftFlushes,
    flushAutosave,
    setPendingClose,
  });

  // Tabs moving BETWEEN windows, in both directions (drag out, drop in,
  // hover preview) - see useTabDragMerge.ts.
  const { dragHoverPreview, handleTabDetach } = useTabDragMerge({
    tabsRef,
    liveTabs,
    t,
    removeTab,
    setTabs,
    setActiveTabId,
  });

  // Nothing to switch between with a single tab, regardless of
  // newDocumentMode - the setting only decides how NEW documents open, not
  // whether the bar shows. A single-tab window stays draggable-to-merge via
  // its native title bar instead (see useTabDragMerge.ts) - but the bar
  // still needs to appear the moment an incoming-tab preview lands, so the
  // incoming tab has somewhere to show up before the merge actually happens.
  const showTabBar = tabs.length > 1 || dragHoverPreview !== null;

  useGlobalShortcuts({
    tabsRef,
    activeTabId,
    setActiveTabId,
    saveTab,
    requestCloseTab,
    toggleSourceMode,
    toggleSidebar,
    toggleAgentPanel,
    toggleSplitView,
    toggleZenMode,
    searchFiles,
  });

  useEffect(() => installClipboardCapture(), []);

  useTutorialTabRecovery(tutorial, tabState, claimPracticeTab);
  usePracticeNotes({
    tutorial,
    tabState,
    language: settings.language,
    evaluate: evaluateTutorialDocumentChange,
  });

  // Files handed over by the OS (Finder "Open With" / double-click, or the
  // `textus` CLI command) at launch, recovered drafts, a dragged-in tab, or a
  // Help doc this window was spawned to show - see startup-restore.ts for
  // the actual priority chain. Deliberately runs only once, at mount.
  useStartupRestore({
    activeTabId,
    enableDraftRecovery: settings.enableDraftRecovery,
    newDocumentMode: settings.newDocumentMode,
    language: settings.language,
    onboardingShown: settings.onboardingShown,
    setTabs,
    setDraftsRestoredCount,
    markOnboardingShown: () => setSettings({ onboardingShown: true }),
    openPathInTab,
    openFile,
    replaceTabWithFile,
    restoreCarets: settings.restoreSessionOnStartup,
    startTutorial,
    stopTutorial,
  });

  // The same, pushed to an already-running window (useFileOpening.ts).
  useOpenPathsPush(openPathInTab);
  useFileDrop(openFile, openPathInTab);

  useWindowCloseGuard(liveTabs, flushAutosave, setPendingClose);

  useExternalChangeReload(liveTabs, updateTab);

  const {
    documentsOpen,
    setDocumentsOpen,
    openFromDocuments,
    documentRenamed,
    documentDeleted,
    skillFilesDeleted,
    shareActiveTab,
  } = useDocumentActions({ tabState, openFile, removeTab, saveTab });

  // Which View items are on: the check marks in the app-drawn menu and in
  // the macOS menu bar.
  const menuChecks = {
    sidebar: panelOpen,
    agentPanel: agentPanel.open,
    sourceMode: !!activeTab.sourceMode && !activeTab.splitView,
    splitView: !!activeTab.sourceMode && !!activeTab.splitView,
    typewriter: settings.typewriterMode,
    zen: zenMode,
    folderOpen: openFolder.folder !== null,
  };
  useNativeMenuChecks(menuChecks);

  // Menu events from Rust (menu.rs's dispatch) - every File/View/Format/Help
  // action the frontend owns arrives here as a window event; see
  // menu-bridge.ts for the actual subscriptions.
  useMenuBridge({
    activeTabId,
    liveTabs,
    t,
    pdfPageNumbers: settings.pdfPageNumbers,
    diagramEngine: settings.diagramEngine,
    onOpenSettings: () => setSettingsOpen(true),
    onToggleTypewriter: () =>
      setSettings({ typewriterMode: !settings.typewriterMode }),
    onToggleSidebar: toggleSidebar,
    onToggleAgentPanel: toggleAgentPanel,
    onToggleSplitView: toggleSplitView,
    onToggleZenMode: toggleZenMode,
    addBlankTab,
    openFileDialog,
    openRecentFile,
    openFolderDialog: openFolder.openFolderDialog,
    openFolder: openFolder.openFolder,
    closeFolder: openFolder.closeFolder,
    saveTab,
    saveTabAs,
    toggleSourceMode,
    requestCloseTab,
    openHelpTab,
    startWelcomeTutorial,
    openCommunity: () => void links.openCommunityPage(settings.language),
    openTutorials: () => void links.openTutorialsPage(settings.language),
    onOpenDocuments: () => setDocumentsOpen(true),
    shareActiveTab,
  });

  const sidebarLesson = useWindowLessons({
    tutorial,
    languageChosen: settings.languageChosen,
    panelOpen,
    panelMode,
    agentPanelOpen: agentPanel.open,
    writingMode: [
      zenMode,
      settings.typewriterMode,
      !!activeTab.sourceMode,
      !!activeTab.splitView,
    ].join(),
    look: `${settings.themeId} ${settings.theme}`,
  });

  const { closeSaving, closeDiscarding, cancelClose, closePrompt } =
    useClosePrompt({
      pendingClose,
      setPendingClose,
      tabState,
      cancelDraftFlushes,
      saveTab,
      removeTab,
      replaceTabWithFile,
    });
  const phone = usePhoneLayout();

  return (
    <AgentPanelProvider
      // The conversation stays in the panel while it plays its exit.
      open={agentPresence.mounted}
      setOpen={agentPanel.setOpen}
      container={agentPanelEl}
      tab={agentPanel.tab}
      setTab={agentPanel.setTab}
    >
      <FlipOnChange
        watch={`${panelOpen} ${agentPresence.mounted} ${zenMode}`}
        targets={() =>
          document.querySelectorAll(
            '[data-active-tab="true"] > .editor-scroll > .editor-content, [data-active-tab="true"] > .source-view, .tab-bar > [data-flip-id]',
          )
        }
        duration="--dur-slow"
        easing="--ease-spring"
      />
      <div
        className="app-shell"
        style={
          {
            // The sidebar's dragged width (sidebar-frame.css); an iPad
            // keeps the stylesheet's, its sidebar has no handle.
            ...(!isIOSApp && {
              "--sidebar-width": `${sidebarWidth.width}px`,
            }),
          } as React.CSSProperties
        }
      >
        <WindowBar
          menuChecks={menuChecks}
          title={activeTitle}
          dirty={activeDirty}
          largeDoc={isLargeDoc}
          words={wordCount.words}
          sidebarOpen={panelOpen}
          sidebarShortcut={formatCombo(settings.shortcuts.toggleSidebar)}
          onToggleSidebar={toggleSidebar}
          showAgentToggle={settings.enableAskAi || tutorial.active}
          agentOpen={agentPanel.open}
          agentShortcut={formatCombo(settings.shortcuts.toggleAgentPanel)}
          onToggleAgent={toggleAgentPanel}
        />
        <Sidebar
          open={panelOpen}
          presence={sidebarPresence}
          closing={sidebarClosing}
          spotlight={sidebarLesson}
          mode={panelMode}
          onModeChange={setPanelMode}
          width={sidebarWidth}
          openFolder={openFolder}
          activePath={activeTab.path}
          activeContent={activeTab.content}
          onToggle={toggleSidebar}
          onClose={() => setPanelOpen(false)}
          onOpenFile={(path) => void openFile(path)}
          searchFocusRequest={searchFocusRequest}
          onSearchFocusHandled={clearSearchFocusRequest}
          t={t}
        />

        <MainPane
          tabs={tabs}
          activeTabId={activeTabId}
          showTabBar={showTabBar}
          onActivate={setActiveTabId}
          onClose={requestCloseTab}
          onAdd={addBlankTab}
          onDetach={handleTabDetach}
          onReorder={reorderTab}
          previewTab={dragHoverPreview}
          onChange={handleChange}
          typewriter={settings.typewriterMode}
          tour={
            tutorial.active && tutorial.tabId
              ? {
                  tabId: tutorial.tabId,
                  ai: tutorial.practiceAi,
                  mode: tutorial.agentMode,
                }
              : null
          }
          t={t}
        />

        {agentPresence.mounted && (
          <AgentPanelDock
            presence={agentPresence}
            closing={agentClosing}
            overlays={agentOverlays}
            sheetFull={sheetFull}
            onSheetFullChange={setSheetFull}
            width={agentPanel.width}
            onResize={agentPanel.setWidth}
            onClose={() => agentPanel.setOpen(false)}
            mountRef={setAgentPanelEl}
            sourceMode={!!activeTab.sourceMode}
            onToggleSourceMode={toggleSourceMode}
            t={t}
          />
        )}

        {/* The longest exit is the phone's: the page going back down. */}
        <Presence show={settingsOpen} exitMs={320}>
          {settingsOpen && (
            <SettingsPanel
              onClose={() => setSettingsOpen(false)}
              onOpenFile={(path) => void openFile(path)}
              onFilesDeleted={skillFilesDeleted}
              viewChecks={{
                sourceMode: !!activeTab.sourceMode && !activeTab.splitView,
                zen: zenMode,
              }}
              fixedShortcuts={fixedShortcutGroups(t, platformName())}
            />
          )}
        </Presence>

        <ClosePrompt
          open={!!pendingClose}
          phone={phone}
          dialogProps={closePrompt}
          onSave={() => void closeSaving()}
          onDiscard={() => void closeDiscarding()}
          onCancel={cancelClose}
          t={t}
        />

        {isIOSApp && <KeyboardToolbar />}
        <Presence show={isIOSApp && documentsOpen} exitMs={320}>
          {isIOSApp && documentsOpen && (
            <DocumentList
              activePath={activeTab.path}
              onClose={() => setDocumentsOpen(false)}
              onOpen={openFromDocuments}
              onRenamed={documentRenamed}
              onDeleted={documentDeleted}
              onOpenOther={() => {
                setDocumentsOpen(false);
                void openFileDialog();
              }}
            />
          )}
        </Presence>
        <AppDialogHost okLabel={t.dialogOk} />

        {zenMode && <ZenHint onExit={() => setZenMode(false)} t={t} />}

        <DraftRestoredToast
          count={draftsRestoredCount}
          onDismiss={() => setDraftsRestoredCount(0)}
          t={t}
        />

        <WordImportNotice
          path={wordImported}
          onDismiss={dismissWordImported}
          t={t}
        />

        <UpdateToast appUpdate={appUpdate} t={t} />

        <OnboardingLayers
          tutorial={tutorial}
          settings={settings}
          setSettings={setSettings}
          levisPending={levisOffer.pending}
          zen={{ on: zenMode, toggle: toggleZenMode }}
          t={t}
        />
      </div>
    </AgentPanelProvider>
  );
}

export default App;
