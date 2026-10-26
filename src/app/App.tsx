import { AppDialogHost } from "../ui/app-dialog";
import { WindowBar } from "./WindowBar";
import { isIOSApp } from "../platform/capabilities";
import { SettingsLayer } from "./SettingsLayer";
import { DocumentList } from "../mobile/DocumentList";
import { KeyboardToolbar } from "../mobile/KeyboardToolbar";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { useSettings } from "../settings/SettingsContext";
import { formatCombo } from "../utils/shortcuts";
import { fixedShortcutGroups } from "./fixed-shortcuts";
import { commands } from "./commands";
import { platformName } from "../platform/window-chrome";
import { Presence } from "../ui/usePresence";
import { FlipOnChange } from "../ui/flip";
import { AgentPanelProvider } from "../ai/chat/panel/agent-panel";
import { aiFeatures } from "../settings/textus-ai";
import { useWindowShell } from "./useWindowShell";
import { useWindowDocuments } from "./useWindowDocuments";
import { useWindowWiring } from "./useWindowWiring";
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
import { QuickPickHost } from "../ui/quick-pick";
import { PluginFormHost } from "../plugins/views/plugin-form";
import { NoticeHost } from "../ui/notices";
import "../plugins/plugins.css";
import "./App.css";

/**
 * One window: its tabs, the panels around them, and the prompts and
 * notices over them. Its frame (useWindowShell), its documents
 * (useWindowDocuments) and what reaches it from outside (useWindowWiring)
 * are hooks of their own, called in the order their parts had when all of
 * this was one function, so their effects still run in it; this is where
 * they meet the components.
 */
function App() {
  const { t, settings, setSettings } = useSettings();
  const shell = useWindowShell({ settings, setSettings });
  const docs = useWindowDocuments({ shell, settings, t });
  const wiring = useWindowWiring({ shell, docs, settings, setSettings, t });
  const phone = usePhoneLayout();

  const { textusAi, tutorial, settingsOpening, appUpdate, pendingClose } =
    shell;
  const { draftsRestoredCount, setDraftsRestoredCount, wordImported } = shell;
  const { tabs, activeTabId, setActiveTabId, addBlankTab, reorderTab } =
    shell.tabState;
  const { panelOpen, setPanelOpen, toggleSidebar, sidebarWidth } = shell.panels;
  const { agentPanel, agentPanelEl, setAgentPanelEl, toggleAgentPanel } =
    shell.panels;
  const { sidebarPresence, sidebarClosing, agentPresence, agentClosing } =
    shell.panels;
  const { sheetFull, setSheetFull, panelMode, setPanelMode } = shell.panels;
  const { activeTab, activeTitle, activeDirty, featuresPaused, wordCount } =
    docs;
  const { openFolder, openFile, openFileDialog, handleChange } = docs;
  const { searchFocusRequest, clearSearchFocusRequest } = docs;
  const { showTabBar, requestCloseTab, handleTabDetach, dragHoverPreview } =
    docs;
  const { toggleSourceMode, zenMode, setZenMode, toggleZenMode } = docs;
  const { menuChecks, sidebarLesson, entryMoved, skillFilesDeleted } = wiring;
  const { documentsOpen, setDocumentsOpen, openFromDocuments } = wiring;
  const { documentRenamed, documentDeleted } = wiring;
  const { closeSaving, closeDiscarding, cancelClose, closePrompt } =
    wiring.close;

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
          largeDoc={featuresPaused}
          words={wordCount.words}
          sidebarOpen={panelOpen}
          sidebarShortcut={formatCombo(settings.shortcuts.toggleSidebar)}
          onToggleSidebar={toggleSidebar}
          showAgentToggle={aiFeatures(settings, tutorial.active).chat}
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
          onOpenFile={(path, beside) =>
            void openFile(path, beside ? { where: "beside" } : {})
          }
          onEntryMoved={entryMoved}
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
            sheetFull={sheetFull}
            onSheetFullChange={setSheetFull}
            width={agentPanel.width}
            onResize={agentPanel.setWidth}
            onClose={() => agentPanel.setOpen(false)}
            mountRef={setAgentPanelEl}
            sourceMode={!!activeTab.sourceMode}
            onToggleSourceMode={toggleSourceMode}
            aiOn={textusAi.on}
            t={t}
          />
        )}

        <SettingsLayer
          opening={settingsOpening}
          onOpenFile={(path) => void openFile(path)}
          onFilesDeleted={skillFilesDeleted}
          viewChecks={{
            sourceMode: !!activeTab.sourceMode && !activeTab.splitView,
            zen: zenMode,
          }}
          fixedShortcuts={fixedShortcutGroups(t, platformName())}
          pluginCommands={commands().map((c) => ({
            id: c.id,
            title: c.title(t),
            shortcut: c.shortcut,
          }))}
        />

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
        <QuickPickHost
          emptyLabel={t.pluginQuickPickEmpty}
          okLabel={t.pluginOk}
        />
        <PluginFormHost />
        <NoticeHost />

        {zenMode && <ZenHint onExit={() => setZenMode(false)} t={t} />}

        <DraftRestoredToast
          count={draftsRestoredCount}
          onDismiss={() => setDraftsRestoredCount(0)}
          t={t}
        />

        <WordImportNotice
          path={wordImported.path}
          onDismiss={wordImported.dismiss}
          t={t}
        />

        <UpdateToast appUpdate={appUpdate} t={t} />

        <OnboardingLayers
          tutorial={tutorial}
          settings={settings}
          setSettings={setSettings}
          zen={{ on: zenMode, toggle: toggleZenMode }}
          t={t}
        />
      </div>
    </AgentPanelProvider>
  );
}

export default App;
