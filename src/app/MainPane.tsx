import { Suspense, type ComponentProps } from "react";
import { EditorPane } from "../document-view/EditorPane";
import {
  canDragTabsBetweenWindows,
  canUseWindows,
} from "../platform/capabilities";
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
import type { ContextMenuItem } from "../editor/ContextMenu";
import { contributedContextItems } from "../ui/context-menu-items";

type TabBarProps = ComponentProps<typeof TabBar>;

// Its Markdown renderer loads when a tab first shows it, not with the window.
const SplitView = lazyComponent(
  lazyModule("split-view", () => import("../editor/modes/SplitView")),
  (m) => m.SplitView,
);

function pluginTabItems(
  path: string | null,
): (ContextMenuItem | "separator")[] {
  const added = contributedContextItems("tab/context", { path });
  return added.length ? ["separator", ...added] : [];
}

/** The document column: the tab bar over every open tab's editor. */

export function MainPane({
  tabs,
  activeTabId,
  showTabBar,
  onActivate,
  onClose,
  onAdd,
  onDetach,
  onMoveToNewWindow,
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
  /** A tab pulled out of the window leaves for a window of its own (macOS). */
  onDetach: (tabId: string) => void;
  onMoveToNewWindow: (tabId: string) => void;
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
          // Pulled over the documents it splits; out of the window it tears
          // off where the platform gives global cursor positions.
          onPullOut={(id, title) =>
            pullTab(id, title, {
              tabIds: tabs.map((tab) => tab.id),
              activate: onActivate,
              detach: canDragTabsBetweenWindows ? onDetach : undefined,
              releaseOutside:
                canUseWindows && !canDragTabsBetweenWindows
                  ? onMoveToNewWindow
                  : undefined,
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
            ...(canUseWindows
              ? [
                  {
                    label: t.moveToNewWindow,
                    onSelect: () => onMoveToNewWindow(id),
                  },
                ]
              : []),
            "separator",
            { label: t.menuCloseTab, onSelect: () => onClose(id) },
            ...pluginTabItems(tabs.find((tab) => tab.id === id)?.path ?? null),
          ]}
          labels={{
            tabs: t.menuDocuments,
            close: t.menuCloseTab,
            add: t.menuNewFile,
            unsaved: t.unsavedIndicator,
          }}
        />
      )}

      {/* Every tab's editor stays mounted, just hidden, so switching keeps
        undo history, scroll position and in-flight AI state. */}
      {/* In a split, a click or focus in a pane brings its tab to the front. */}
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
