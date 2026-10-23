import type { ComponentProps } from "react";
import { EditorPane } from "../document-view/EditorPane";
import { canDragTabsBetweenWindows } from "../platform/capabilities";
import { SplitView } from "../editor/modes/SplitView";
import { SourceTextarea } from "../editor/modes/SourceTextarea";
import { tabIsDirty, tabTitle, type DocTab } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";
import type { TourAi } from "../utils/events";
import type { AgentMode } from "../settings/SettingsContext";
import { PluginTabPane } from "../plugins/PluginWebview";
import { WebPagePane } from "../plugins/WebPagePane";
import { TabBar } from "./TabBar";

type TabBarProps = ComponentProps<typeof TabBar>;

/** The document column: the tab bar (when there is more than one tab to
 *  switch between) over every open tab's editor. */
export function MainPane({
  tabs,
  activeTabId,
  showTabBar,
  onActivate,
  onClose,
  onAdd,
  onDetach,
  onReorder,
  previewTab,
  onChange,
  typewriter,
  tour,
  t,
}: {
  tabs: DocTab[];
  activeTabId: string;
  showTabBar: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onAdd: () => void;
  onDetach: NonNullable<TabBarProps["onDetach"]>;
  onReorder: (tabId: string, index: number) => void;
  previewTab: TabBarProps["previewTab"];
  onChange: (tabId: string, markdown: string) => void;
  typewriter: boolean;
  /** The tour's practice tab, its AI and the AI panel mode its lesson
   *  needs, while the tour runs; else null. */
  tour: { tabId: string; ai: TourAi; mode: AgentMode | null } | null;
  t: Strings;
}) {
  return (
    <main className="main-pane">
      {showTabBar && (
        <TabBar
          tabs={tabs.map((tab) => ({
            id: tab.id,
            title: tabTitle(tab, t),
            dirty: tabIsDirty(tab),
          }))}
          activeTabId={activeTabId}
          onActivate={onActivate}
          onClose={onClose}
          onAdd={onAdd}
          // Tear-off needs global cursor and window positions - macOS
          // only (tab_drag.rs); on Linux, and above all under Wayland,
          // the drag could only fail and cancel the reorder with it.
          onDetach={canDragTabsBetweenWindows ? onDetach : undefined}
          onReorder={onReorder}
          previewTab={previewTab}
          labels={{
            tabs: t.menuDocuments,
            close: t.menuCloseTab,
            add: t.menuNewFile,
            unsaved: t.unsavedIndicator,
          }}
        />
      )}

      {/* Every open tab's editor stays mounted (just hidden) so switching
        tabs preserves undo history, scroll position, and in-flight AI
        state - only the active one is ever unmounted-on-purpose (via
        reloadKey, when leaving source mode). */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          data-active-tab={tab.id === activeTabId}
          style={{ display: tab.id === activeTabId ? "contents" : "none" }}
        >
          {tab.view?.kind === "web" && tab.view.resource ? (
            <WebPagePane url={tab.view.resource} t={t} />
          ) : tab.view && tab.view.kind !== "web" ? (
            <PluginTabPane
              tabId={tab.id}
              plugin={tab.view.plugin}
              view={tab.view.view}
              kind={tab.view.kind}
              resource={tab.view.resource}
              state={tab.view.state}
            />
          ) : tab.sourceMode && tab.splitView ? (
            <SplitView
              content={tab.content}
              filePath={tab.path}
              typewriter={typewriter}
              onChange={(markdown) => onChange(tab.id, markdown)}
            />
          ) : tab.sourceMode ? (
            <SourceTextarea
              value={tab.content}
              typewriter={typewriter}
              onChange={(markdown) => onChange(tab.id, markdown)}
            />
          ) : (
            <EditorPane
              key={`${tab.id}-${tab.reloadKey}`}
              tabId={tab.id}
              filePath={tab.path}
              docTitle={tabTitle(tab, t)}
              initialValue={tab.content}
              onChange={onChange}
              isActive={tab.id === activeTabId}
              tour={tour && tab.id === tour.tabId ? tour.ai : null}
              tourMode={tour && tab.id === tour.tabId ? tour.mode : null}
            />
          )}
        </div>
      ))}
    </main>
  );
}
