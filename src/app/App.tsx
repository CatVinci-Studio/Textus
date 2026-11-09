import { SuggestCard } from "./SuggestCard";
import { ConventionsCard } from "./ConventionsCard";
import { CornerStack } from "../ui/CornerToast";
import { Suspense, useState } from "react";
import { AppDialogHost } from "../ui/app-dialog";
import { WindowBar } from "./WindowBar";
import { isIOSApp } from "../platform/capabilities";
import { appDrawsWindowFrame } from "../platform/window-chrome";
import { SettingsLayer } from "./SettingsLayer";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { useSettings } from "../prefs/SettingsContext";
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
import { FloatingViewsHost } from "../plugins/views/floating-views-host";
import { NoticeHost } from "../ui/notices";
import "../plugins/plugins.css";
import "./App.css";
import { ReportProblemHost } from "./report/report-open";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";
import { usePanelsReport } from "../plugins/panels-state";

// The phone's own parts load on the phone, not with every desktop window.
const phoneParts = lazyModule(
  "phone-parts",
  () => import("../mobile/phone-parts"),
);
const DocumentList = lazyComponent(phoneParts, (m) => m.DocumentList);
const KeyboardToolbar = lazyComponent(phoneParts, (m) => m.KeyboardToolbar);

/**
 * One window: its tabs, the panels around them, and the prompts and notices
 * over them. The hooks run in a fixed order so their effects keep theirs.
 */
function App() {
  const { t, settings, setSettings } = useSettings();
  // Whether the main pane's top row has tabs (MainPane says, as it knows
  // its split).
  const [tabsInBar, setTabsInBar] = useState(false);
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
  const { panelMode, setPanelMode } = shell.panels;
  const { activeTab, activeTitle, activeDirty, featuresPaused, wordCount } =
    docs;
  const { openFolder, openFile, openFileDialog, handleChange } = docs;
  const { searchFocusRequest, clearSearchFocusRequest } = docs;
  const { showTabBar, requestCloseTab, handleTabDetach, dragHoverPreview } =
    docs;
  const { moveTabToNewWindow, toggleReadOnly } = docs;
  const { toggleSourceMode, zenMode, setZenMode } = docs;
  const { menuChecks, entryMoved, skillFilesDeleted } = wiring;
  const { documentsOpen, setDocumentsOpen, openFromDocuments } = wiring;
  const { documentRenamed, documentDeleted } = wiring;
  const { closeSaving, closeDiscarding, cancelClose, closePrompt } =
    wiring.close;
  usePanelsReport({
    sidebarOpen: panelOpen,
    sidebarTab: panelMode,
    aiOpen: agentPanel.open,
    zen: zenMode,
  });

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
        // The layout's switches for the styles (layout/layout*.css): floating islands or classic, and the tabs in the
        // window bar's row, in a row of their own under the menu bar, or
        // none.
        data-layout={settings.layout}
        data-tabs={
          !tabsInBar || isIOSApp
            ? undefined
            : appDrawsWindowFrame && settings.menuBarShown
              ? "row"
              : "bar"
        }
        style={
          {
            // The sidebar's dragged width; an iPad's sidebar has no handle.
            ...(!isIOSApp && {
              "--sidebar-width": `${sidebarWidth.width}px`,
            }),
            // The document column is half the sidebar's width right of the
            // window's centre, and half the AI panel's width left of it. The
            // window bar's title follows both to stay over the column. The
            // sidebar's half is kept apart so it can ride the sidebar's
            // slide; the panel's so it can follow the room the editor makes
            // or takes back, at the page's pace.
            "--window-bar-title-slide": `${
              panelOpen ? sidebarWidth.width / 2 : 0
            }px`,
            "--window-bar-title-shift": `${
              agentPresence.mounted ? -(agentPanel.width / 2) : 0
            }px`,
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
          onToggleReadOnly={() => toggleReadOnly()}
        />
        <Sidebar
          open={panelOpen}
          presence={sidebarPresence}
          closing={sidebarClosing}
          mode={panelMode}
          onModeChange={setPanelMode}
          width={sidebarWidth}
          openFolder={openFolder}
          activePath={activeTab.path}
          activeContent={activeTab.content}
          activeTabId={activeTab.id}
          onToggle={toggleSidebar}
          onClose={() => setPanelOpen(false)}
          onOpenFile={(path, how) =>
            void openFile(
              path,
              how === "beside"
                ? { where: "beside" }
                : { preview: how === "preview" },
            )
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
          onMoveToNewWindow={moveTabToNewWindow}
          onToggleReadOnly={toggleReadOnly}
          onReorder={reorderTab}
          onKeep={(id) => shell.tabState.updateTab(id, { preview: false })}
          previewTab={dragHoverPreview}
          onTabsInBar={setTabsInBar}
          onChange={handleChange}
          typewriter={settings.typewriterMode}
          formatBar={settings.formatBar}
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
            width={agentPanel.width}
            min={agentPanel.min}
            max={agentPanel.max}
            onResize={agentPanel.setWidth}
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
          docPath={activeTab.path}
          fixedShortcuts={fixedShortcutGroups(t, platformName())}
          pluginCommands={commands()
            // Textus's own (Save, Close Tab) have their keys under File.
            .filter((c) => !c.id.startsWith("textus."))
            .map((c) => ({
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

        {isIOSApp && (
          <Suspense fallback={null}>
            <KeyboardToolbar />
          </Suspense>
        )}
        <Presence show={isIOSApp && documentsOpen} exitMs={320}>
          {isIOSApp && documentsOpen && (
            <Suspense fallback={null}>
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
            </Suspense>
          )}
        </Presence>
        <AppDialogHost okLabel={t.dialogOk} />
        <ReportProblemHost t={t} settings={settings} />
        <QuickPickHost
          emptyLabel={t.pluginQuickPickEmpty}
          okLabel={t.pluginOk}
        />
        <PluginFormHost />
        <FloatingViewsHost />
        <NoticeHost />

        {zenMode && <ZenHint onExit={() => setZenMode(false)} t={t} />}

        <CornerStack corner="start">
          <WordImportNotice
            path={wordImported.path}
            onDismiss={wordImported.dismiss}
            t={t}
          />
          <DraftRestoredToast
            count={draftsRestoredCount}
            onDismiss={() => setDraftsRestoredCount(0)}
            t={t}
          />
        </CornerStack>

        <CornerStack corner="end">
          <SuggestCard t={t} />
          <ConventionsCard path={activeTab.path} settings={settings} t={t} />
          <UpdateToast appUpdate={appUpdate} t={t} />
        </CornerStack>

        <OnboardingLayers
          tutorial={tutorial}
          settings={settings}
          setSettings={setSettings}
          t={t}
        />
      </div>
    </AgentPanelProvider>
  );
}

export default App;
