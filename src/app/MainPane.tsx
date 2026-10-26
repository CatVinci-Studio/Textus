import { Suspense, type ComponentProps } from "react";
import { EditorPane } from "../document-view/EditorPane";
import { canDragTabsBetweenWindows } from "../platform/capabilities";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";
import { SourceTextarea } from "../editor/modes/SourceTextarea";
import { tabIsDirty, tabTitle, type DocTab } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";
import type { TourAi } from "../utils/events";
import type { AgentMode } from "../settings/SettingsContext";
import {
  PluginListPane,
  PluginTabPane,
  WebPagePane,
} from "../plugins/views/plugin-views";
import { TabBar } from "./tabs/TabBar";
import { useSplitPanes } from "./split/useSplitPanes";
import { SplitDivider, splitGridStyles } from "./split/SplitDivider";
import "./split/split-panes.css";
import { openBeside, splitEditor } from "./split/split-layout";
import { pullTab } from "./split/split-drop";

type TabBarProps = ComponentProps<typeof TabBar>;

// Split View renders the page as HTML beside the source: its Markdown
// renderer loads when a tab first shows it, not with the window.
const SplitView = lazyComponent(
  lazyModule("split-view", () => import("../editor/modes/SplitView")),
  (m) => m.SplitView,
);

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
  /** A tab pulled out of the window: it leaves for a window of its own
   *  (tab_drag.rs, macOS). */
  onDetach: (tabId: string) => void;
  onReorder: (tabId: string, index: number) => void;
  previewTab: TabBarProps["previewTab"];
  onChange: (tabId: string, markdown: string) => void;
  typewriter: boolean;
  /** The tour's practice tab, its AI and the AI panel mode its lesson
   *  needs, while the tour runs; else null. */
  tour: { tabId: string; ai: TourAi; mode: AgentMode | null } | null;
  t: Strings;
}) {
  const split = useSplitPanes(
    tabs.map((tab) => tab.id),
    activeTabId,
    onAdd,
  );
  const grid = split && splitGridStyles(split, showTabBar);
  const paneOf = (id: string) =>
    split?.panes[0] === id ? "first" : split?.panes[1] === id ? "second" : null;
  return (
    <main
      className={split ? "main-pane main-pane-split" : "main-pane"}
      data-split={split?.direction}
      style={grid?.column}
    >
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
          // Pulled down: over the documents it splits, as in VS Code;
          // out of the window it tears off - which needs global cursor
          // and window positions, macOS only (tab_drag.rs).
          onPullOut={(id, title) =>
            pullTab(id, title, {
              tabIds: tabs.map((tab) => tab.id),
              activate: onActivate,
              detach: canDragTabsBetweenWindows ? onDetach : undefined,
            })
          }
          onReorder={onReorder}
          previewTab={previewTab}
          menuFor={(id) => [
            {
              label: t.openBeside,
              // The tab in front splits with its neighbour; another one
              // opens beside it.
              onSelect: () =>
                id === activeTabId
                  ? splitEditor("row")
                  : openBeside(id, activeTabId),
            },
            "separator",
            { label: t.menuCloseTab, onSelect: () => onClose(id) },
          ]}
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
      {/* Split (a plugin's, through split-layout.ts), two tabs show side
        by side, each in its pane; a click or focus in one brings its tab
        to the front. */}
      {tabs.map((tab) => {
        const pane = paneOf(tab.id);
        return (
          <div
            key={tab.id}
            data-active-tab={tab.id === activeTabId}
            data-tab-id={tab.id}
            data-pane={pane ?? undefined}
            className={pane ? "split-pane" : undefined}
            style={
              pane && grid
                ? grid[pane]
                : { display: tab.id === activeTabId ? "contents" : "none" }
            }
            onPointerDownCapture={
              pane && tab.id !== activeTabId
                ? () => onActivate(tab.id)
                : undefined
            }
            onFocusCapture={
              pane && tab.id !== activeTabId
                ? () => onActivate(tab.id)
                : undefined
            }
          >
            {tab.view?.kind === "web" && tab.view.resource ? (
              <WebPagePane tabId={tab.id} url={tab.view.resource} t={t} />
            ) : tab.view?.kind === "list" ? (
              <PluginListPane
                plugin={tab.view.plugin}
                view={tab.view.view}
                className="plugin-list-tab"
              />
            ) : tab.view && tab.view.kind !== "web" ? (
              <PluginTabPane
                tabId={tab.id}
                plugin={tab.view.plugin}
                view={tab.view.view}
                kind={tab.view.kind}
                resource={tab.view.resource}
                state={tab.view.state}
                target={tab.view.target}
              />
            ) : tab.sourceMode && tab.splitView ? (
              <Suspense fallback={null}>
                <SplitView
                  content={tab.content}
                  filePath={tab.path}
                  typewriter={typewriter}
                  onChange={(markdown) => onChange(tab.id, markdown)}
                />
              </Suspense>
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
        );
      })}
      {split && grid && (
        <SplitDivider layout={split} style={grid.divider} t={t} />
      )}
    </main>
  );
}
