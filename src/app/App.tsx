import { provideAiFileMarks } from "../ai/revision/file-marks";
import { useTabsInBar } from "./islands/tabs-in-bar";
import { tabTitle } from "../document/doc-tabs";
import { useWindowAi } from "./islands/useWindowAi";
import { conversationIn } from "./islands/ai-tabs";
import { ConventionsCard } from "./ConventionsCard";
import { CornerStack } from "../engine/controls/CornerToast";
import { Suspense } from "react";
import { AppDialogHost } from "../engine/controls/app-dialog";
import { WindowBar } from "./frame/WindowBar";
import { hasDocumentsList } from "../platform/capabilities";
import {
  CreateTabPage,
  PluginTabPage,
  SettingsLayer,
  SettingsTabPage,
} from "./SettingsLayer";
import {
  PageTabProvider,
  type AppPage,
  type PageRequest,
} from "./tabs/page-tabs";
import { usePhoneLayout } from "../engine/controls/usePhoneLayout";
import { useSettings } from "../prefs/SettingsContext";
import { formatCombo } from "../utils/shortcuts";
import { fixedShortcutGroups } from "../registry/fixed-shortcuts";
import { commands } from "../registry/commands";
import { platformName } from "../platform/window-chrome";
import { Presence } from "../engine/motion/usePresence";
import { AgentPanelProvider } from "../ai/chat/panel/agent-panel";
import { aiFeatures } from "../prefs/ai-features";
import { useWindowShell } from "./useWindowShell";
import { useWindowDocuments } from "./useWindowDocuments";
import { useWindowWiring } from "./useWindowWiring";
import { Sidebar } from "./frame/Sidebar";
import { DocumentIslands } from "./islands/DocumentIslands";
import { ClosePrompt } from "./ClosePrompt";
import { DraftRestoredToast, WordImportNotice, ZenExit } from "./AppNotices";
import { OnboardingLayers } from "./OnboardingLayers";
import { QuickPickSlot } from "../engine/controls/QuickPickSlot";
import { PluginFormSlot } from "../plugins/views/PluginFormSlot";
import { FloatingViewsHost } from "../plugins/views/floating-views-host";
import { NoticeHost } from "../engine/controls/notices";
import "../plugins/plugins.css";
import "./App.css";
import { ReportProblemHost } from "./report/report-open";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";
import { usePanelsReport } from "../plugins/panels-state";

// The folder's rows show what Textus AI changed in their files.
provideAiFileMarks();

// The phone's own parts load on the phone, not with every desktop window.
// An AI tab and the plugin suggestion card: drawn later than the window's
// first frame, loaded while it is idle.
const AiTab = lazyComponent(
  lazyModule("ai-tab", () => import("./islands/AiTab"), { warm: true }),
  (m) => m.AiTab,
);
const SuggestCard = lazyComponent(
  lazyModule("suggest-card", () => import("./SuggestCard"), { warm: true }),
  (m) => m.SuggestCard,
);

const phoneParts = lazyModule(
  "phone-parts",
  () => import("../mobile/phone-parts"),
);
const DocumentList = lazyComponent(phoneParts, (m) => m.DocumentList);

/**
 * One window: its tabs, the panels around them, and the prompts and notices
 * over them. The hooks run in a fixed order so their effects keep theirs.
 */
function App() {
  const { t, settings, setSettings } = useSettings();
  const shell = useWindowShell({ settings, setSettings });
  const docs = useWindowDocuments({ shell, settings, t });
  const wiring = useWindowWiring({ shell, docs, settings, setSettings, t });
  const phone = usePhoneLayout();

  const { tutorial, settingsOpening, pendingClose } = shell;
  const { draftsRestoredCount, setDraftsRestoredCount, wordImported } = shell;
  const { tabs, activeTabId, setActiveTabId, addBlankTab } = shell.tabState;
  const { panelOpen, setPanelOpen, toggleSidebar, sidebarWidth } = shell.panels;
  const { agentPanel, toggleAgentPanel } = shell.panels;
  const { sidebarPresence, sidebarClosing, agentPresence } = shell.panels;
  const { panelMode, setPanelMode } = shell.panels;
  const { activeTab, activeTitle, activeDirty } = docs;
  const { openFolder, openFile, openFileDialog, handleChange } = docs;
  const { searchFocusRequest, clearSearchFocusRequest } = docs;
  const { showTabBar, requestCloseTab, handleTabDetach, dragHoverPreview } =
    docs;
  const { moveTabToNewWindow, toggleReadOnly } = docs;
  const { zenMode, setZenMode } = docs;
  // Zen puts the sidebar away as a close does, on the window's clock.
  const sidebarShown = panelOpen && !zenMode;
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

  useWindowAi({
    tabs: shell.tabState,
    workspaceRoot: settings.agentWorkspaceRoot || null,
    shown: agentPanel.open,
    setShown: agentPanel.setOpen,
  });

  // Whether the documents lie on islands: their tabs in the window bar's
  // row (or the row under a bar of its own), or one sheet alone under the
  // title's row - else a clean sheet (Zen), or the phone's own bar.
  const tabsInBar = useTabsInBar(zenMode, showTabBar);
  const tabRow = tabsInBar || !zenMode ? "bar" : undefined;

  // What Settings needs, as a sheet or as a tab.
  const settingsProps = {
    onOpenFile: (path: string) => void openFile(path),
    onFilesDeleted: skillFilesDeleted,
    docPath: activeTab.path,
    fixedShortcuts: fixedShortcutGroups(t, platformName()),
    pluginCommands: commands()
      // Textus's own (Save, Close Tab) have their keys under File.
      .filter((c) => !c.id.startsWith("textus."))
      .map((c) => ({ id: c.id, title: c.title(t), shortcut: c.shortcut })),
  };
  const renderPage = (page: AppPage, request: PageRequest | null) =>
    page === "ai" ? (
      <AiTab conversation={conversationIn(request)} />
    ) : page === "settings" ? (
      <SettingsTabPage request={request} {...settingsProps} />
    ) : page === "create" ? (
      <CreateTabPage t={t} />
    ) : (
      <PluginTabPage request={request} t={t} />
    );

  return (
    <PageTabProvider render={renderPage}>
      <AgentPanelProvider
        // The conversation stays in the panel while it plays its exit.
        open={agentPresence.mounted}
        setOpen={agentPanel.setOpen}
        tab={agentPanel.tab}
        setTab={agentPanel.setTab}
      >
        <div
          className="app-shell"
          // The layout's switches for the styles (layout/layout*.css): floating islands or classic, and the tabs in the
          // window bar's row, in a row of their own under the menu bar, or
          // none.
          data-tabs={tabRow}
          // Its column open: the grid and the rail's edge follow the model.
          data-sidebar={sidebarShown ? "open" : undefined}
          // The sidebar's dragged width; a phone's is its stylesheet's.
          style={
            phone
              ? undefined
              : ({
                  "--sidebar-width": `${sidebarWidth.width}px`,
                } as React.CSSProperties)
          }
        >
          <WindowBar
            menuChecks={menuChecks}
            title={activeTitle}
            dirty={activeDirty}
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
            open={sidebarShown}
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
            onOpenFile={(path, how, line) => {
              // A phone's page comes back with the file opened.
              if (phone) setPanelOpen(false);
              void openFile(path, {
                ...(how === "beside"
                  ? { where: "beside" }
                  : { preview: how === "preview" }),
                ...(line !== undefined ? { place: { line } } : {}),
              });
            }}
            onEntryMoved={entryMoved}
            searchFocusRequest={searchFocusRequest}
            onSearchFocusHandled={clearSearchFocusRequest}
            t={t}
          />

          <DocumentIslands
            tabs={tabs}
            activeTabId={activeTabId}
            showTabBar={showTabBar}
            onActivate={setActiveTabId}
            onClose={requestCloseTab}
            onAdd={addBlankTab}
            onDetach={handleTabDetach}
            onMoveToNewWindow={moveTabToNewWindow}
            onToggleReadOnly={toggleReadOnly}
            onKeep={(id) => shell.tabState.updateTab(id, { preview: false })}
            previewTab={dragHoverPreview}
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
            zen={zenMode}
            lang={settings.language}
            t={t}
          />

          <SettingsLayer opening={settingsOpening} {...settingsProps} />

          <ClosePrompt
            open={!!pendingClose}
            phone={phone}
            dialogProps={closePrompt}
            onSave={() => void closeSaving()}
            onDiscard={() => void closeDiscarding()}
            onCancel={cancelClose}
            name={
              pendingClose?.kind === "tab"
                ? tabTitle(
                    tabs.find((tab) => tab.id === pendingClose.tabId) ??
                      tabs[0],
                    t,
                  )
                : null
            }
            t={t}
          />

          <Presence show={hasDocumentsList && documentsOpen}>
            {hasDocumentsList && documentsOpen && (
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
          <QuickPickSlot
            emptyLabel={t.pluginQuickPickEmpty}
            okLabel={t.pluginOk}
          />
          <PluginFormSlot />
          <FloatingViewsHost />
          <NoticeHost />

          {zenMode && <ZenExit onExit={() => setZenMode(false)} t={t} />}

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
          </CornerStack>

          <OnboardingLayers
            tutorial={tutorial}
            settings={settings}
            setSettings={setSettings}
            t={t}
          />
        </div>
      </AgentPanelProvider>
    </PageTabProvider>
  );
}

export default App;
