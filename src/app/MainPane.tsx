import { Island } from "../engine/layout/Island";
import { EditorKept, KeptWhileHidden } from "./islands/kept";
import { IslandMotion } from "./layout/IslandMotion";
import { DocumentCorners } from "./islands/DocumentCorner";
import type { Lang } from "../i18n/langs";
import type { ReactNode } from "react";
import {
  type ComponentProps,
  type CSSProperties,
  Suspense,
  useLayoutEffect,
  useRef,
} from "react";
import { useTabRows } from "./layout/useTabRows";
import { usePhoneLayout } from "../engine/controls/usePhoneLayout";
import { EditorPane } from "../document-view/EditorPane";
import {
  canDragTabsBetweenWindows,
  canUseWindows,
} from "../platform/capabilities";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";
import { DocSourceEditor } from "../editor/modes/lazy-doc-source-editor";
import {
  showsStartPage,
  tabIsDirty,
  tabTitle,
  type DocTab,
} from "../document/doc-tabs";
import { tabReadOnly } from "../document/read-only";
import type { Strings } from "../i18n/strings";
import type { TourAi } from "../utils/events";
import type { AgentMode } from "../prefs/SettingsContext";
import {
  PluginListPane,
  PluginTabPane,
  WebPagePane,
} from "../plugins/views/plugin-views";
import { TabBar } from "./tabs/TabBar";
import { tabMenuItems } from "./tabs/tab-menu-items";
import { FormatBar } from "./FormatBar";
import { useSplitPanes } from "./layout/useSplitPanes";
import { SplitDivider } from "./layout/SplitDivider";
import { islandOf, panesOf, splitGrid, type SplitGrid } from "./layout/tree";
import type { AiIslandPlace } from "./islands/AiIsland";
import "./layout/split-panes.css";
import {
  focusPane,
  openBeside,
  reorderInPane,
  splitEditor,
} from "./layout/store";
import { pullTab } from "./layout/split-drop";
import type { ContextMenuItem } from "../engine/controls/ContextMenu";
import { contributedContextItems } from "../engine/controls/context-menu-items";
import { withPluginBlocks } from "../document-view/plugins/plugin-code-blocks";

type TabBarProps = ComponentProps<typeof TabBar>;

// Its Markdown renderer loads when a tab first shows it, not with the window.
// Shown only when the user chose it, so kept out of the startup chunk.
const StartPage = lazyComponent(
  // Loaded while the window is idle: on first use React holds a suspended
  // page back for 300ms, a pause between closing a document and the page.
  lazyModule("start-page", () => import("./StartPage"), { warm: true }),
  (m) => m.StartPage,
);
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

/** Panes named in reading order, for tests and styles to find. */
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];

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
  onToggleReadOnly,
  onReorder,
  onKeep,
  previewTab,
  onTabsInBar,
  onChange,
  typewriter,
  formatBar,
  tour,
  aiIsland,
  zen,
  lang,
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
  onToggleReadOnly: (tabId: string) => void;
  onReorder: (tabId: string, index: number) => void;
  /** A preview tab kept. */
  onKeep: (tabId: string) => void;
  previewTab: TabBarProps["previewTab"];
  /** Told, before paint, whether the top row has tabs: the window bar's
   *  then (App's data-tabs). */
  onTabsInBar: (shown: boolean) => void;
  onChange: (tabId: string, markdown: string) => void;
  typewriter: boolean;
  /** View › Format Bar is on. */
  formatBar: boolean;
  /** The tour's practice tab, its AI and the AI panel mode its lesson
   *  needs, while the tour runs; else null. */
  tour: { tabId: string; ai: TourAi; mode: AgentMode | null } | null;
  /** Draws the AI island at its place in the grid (AiIsland). */
  aiIsland?: (place: AiIslandPlace) => ReactNode;
  /** Zen: no tabs, the documents plain paper (the AI island's beside them
   *  too). */
  zen: boolean;
  /** The interface's language: how a document's length is counted. */
  lang: Lang;
  t: Strings;
}) {
  const mainRef = useRef<HTMLElement>(null);
  useTabRows(mainRef);
  const split = useSplitPanes(
    tabs.map((tab) => tab.id),
    activeTabId,
    onAdd,
  );
  const phone = usePhoneLayout();
  // A phone's column has its bar of its own, not islands.
  const islands = canUseWindows;
  const grid = split && splitGrid(split.root);
  const all = split ? panesOf(split.root) : [];
  const panes = all.filter((p) => islandOf(p) === "documents");
  const ai = all.find((p) => islandOf(p) === "ai");
  // Documents split, not only beside the AI island.
  const docsSplit = panes.length > 1;
  // Each pane shows its tab in front; its place in reading order names it.
  const shownIn = new Map(
    panes.flatMap((p, i) =>
      p.front ? [[p.front, { id: p.id, name: ORDINALS[i] ?? `${i + 1}` }]] : [],
    ),
  );
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  // A split's top panes always have their tabs; one pane, when shown;
  // none in Zen, its documents plain paper.
  const tabsInBar = !zen && (docsSplit || showTabBar);
  // The one pane's sheet, without its row, reaches up into the bar's.
  const body = (id: string) =>
    tabsInBar || !grid ? grid?.bodies.get(id) : withBarRow(grid, id);
  useLayoutEffect(() => onTabsInBar(tabsInBar), [tabsInBar, onTabsInBar]);
  const { pathItem, readOnlyItem, closeManyItems } = tabMenuItems({
    tabs,
    activeTabId,
    onActivate,
    onClose,
    onToggleReadOnly,
    t,
  });
  const tabBar = (
    list: DocTab[],
    active: string,
    pane: string | null,
    inner = false,
    style?: CSSProperties,
  ) => (
    <TabBar
      key={pane ?? "window"}
      style={style}
      paneId={pane ?? undefined}
      inner={inner}
      tabs={list.map((tab) => ({
        id: tab.id,
        title: tabTitle(tab, t),
        dirty: tabIsDirty(tab),
        preview: tab.preview,
        path: tab.path,
        readOnly: tabReadOnly(tab),
      }))}
      onUnlock={onToggleReadOnly}
      onKeep={onKeep}
      activeTabId={active}
      onActivate={onActivate}
      onClose={onClose}
      onAdd={() => {
        if (pane !== null) focusPane(pane);
        onAdd();
      }}
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
      onReorder={
        pane === null
          ? onReorder
          : (id, index) => reorderInPane(pane, id, index)
      }
      previewTab={pane === null || pane === panes[0]?.id ? previewTab : null}
      menuFor={(id) => [
        {
          // A phone's column only stacks.
          label: phone ? t.menuSplitDown : t.openBeside,
          // The tab in front splits with its neighbour; another one
          // opens beside it.
          onSelect: () =>
            id === activeTabId && !docsSplit
              ? splitEditor(phone ? "column" : "row")
              : openBeside(id, activeTabId, phone ? "bottom" : "right"),
        },
        ...(canUseWindows
          ? [
              {
                label: t.moveToNewWindow,
                onSelect: () => onMoveToNewWindow(id),
              },
            ]
          : []),
        ...pathItem(id, byId.get(id)?.path),
        ...readOnlyItem(id),
        "separator",
        { label: t.menuCloseTab, onSelect: () => onClose(id) },
        ...closeManyItems(list, id),
        ...pluginTabItems(byId.get(id)?.path ?? null),
      ]}
      labels={{
        tabs: t.menuDocuments,
        close: t.menuCloseTab,
        add: t.menuNewTab,
        unsaved: t.unsavedIndicator,
        all: t.menuAllTabs,
        readOnly: t.readOnlyLock,
      }}
    />
  );

  return (
    <main
      ref={mainRef}
      className={split ? "main-pane main-pane-split" : "main-pane"}
      data-split={split?.root.direction}
      style={grid?.column}
    >
      <IslandMotion
        layout={`${grid?.column.gridTemplateColumns} ${grid?.column.gridTemplateRows} ${all.map((p) => p.id)}`}
        area={mainRef}
      />
      {/* Each pane of documents an island: its row of tabs over its sheet,
          its documents on the sheet (below). A phone's column has its own
          bar; a clean sheet is the page itself. */}
      {!islands
        ? split && grid
          ? panes.map((p) =>
              tabBar(
                p.tabs.flatMap((id) => byId.get(id) ?? []),
                p.front ?? "",
                p.id,
                !grid.top.has(p.id),
                grid.bars.get(p.id),
              ),
            )
          : showTabBar && tabBar(tabs, activeTabId, null)
        : split && grid
          ? tabsInBar &&
            panes.map((p) => (
              <Island
                key={`island:${p.id}`}
                kind="documents"
                paneId={p.id}
                row={tabBar(
                  p.tabs.flatMap((id) => byId.get(id) ?? []),
                  p.front ?? "",
                  p.id,
                  !grid.top.has(p.id),
                )}
                rowStyle={grid.bars.get(p.id)}
                inner={!grid.top.has(p.id)}
                sheetStyle={body(p.id)}
              />
            ))
          : showTabBar && (
              <Island kind="documents" row={tabBar(tabs, activeTabId, null)} />
            )}
      {/* Each document's length at its page's corner. */}
      {islands && (
        <DocumentCorners
          fronts={
            split && grid
              ? panes.map((p) => ({
                  tab: byId.get(p.front ?? ""),
                  style: body(p.id),
                }))
              : [{ tab: byId.get(activeTabId) }]
          }
          lang={lang}
          t={t}
        />
      )}
      {ai &&
        grid &&
        aiIsland?.({
          paneId: ai.id,
          bar: grid.bars.get(ai.id),
          body: grid.bodies.get(ai.id),
          inner: !grid.top.has(ai.id),
          plain: !tabsInBar,
        })}
      {formatBar &&
        !docsSplit &&
        !phone &&
        formatsShown(byId.get(activeTabId)) && (
          <FormatBar
            t={t}
            // Beside the AI island, over the documents' sheet alone.
            style={split && panes[0] ? body(panes[0].id) : undefined}
          />
        )}

      {/* A tab's editor stays mounted while hidden, so switching keeps its
        state; one out of sight a long while is let go (EditorKept). */}
      {/* In a split, a click or focus in a pane brings its tab to the front. */}
      {tabs.map((tab) => {
        const pane = shownIn.get(tab.id);
        return (
          <div
            key={tab.id}
            data-active-tab={tab.id === activeTabId}
            data-tab-id={tab.id}
            data-pane={pane?.name}
            data-pane-id={pane?.id}
            className={pane ? "split-pane" : undefined}
            style={
              pane && grid
                ? body(pane.id)
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
              <KeptWhileHidden shown={tab.id === activeTabId || !!pane}>
                <PluginListPane
                  plugin={tab.view.plugin}
                  view={tab.view.view}
                  className="plugin-list-tab"
                />
              </KeptWhileHidden>
            ) : tab.view && tab.view.kind !== "web" ? (
              <KeptWhileHidden shown={tab.id === activeTabId || !!pane}>
                <PluginTabPane
                  tabId={tab.id}
                  plugin={tab.view.plugin}
                  view={tab.view.view}
                  kind={tab.view.kind}
                  resource={tab.view.resource}
                  state={tab.view.state}
                  target={tab.view.target}
                />
              </KeptWhileHidden>
            ) : showsStartPage(tab) ? (
              <Suspense fallback={null}>
                <StartPage t={t} />
              </Suspense>
            ) : tab.sourceMode && tab.splitView ? (
              <Suspense fallback={null}>
                <SplitView
                  content={tab.content}
                  filePath={tab.path}
                  typewriter={typewriter}
                  onChange={(markdown) => onChange(tab.id, markdown)}
                  readOnly={tabReadOnly(tab)}
                  previewExtras={withPluginBlocks}
                />
              </Suspense>
            ) : tab.sourceMode ? (
              <Suspense fallback={null}>
                <DocSourceEditor
                  value={tab.content}
                  docPath={tab.path}
                  typewriter={typewriter}
                  onChange={(markdown) => onChange(tab.id, markdown)}
                  readOnly={tabReadOnly(tab)}
                />
              </Suspense>
            ) : (
              <EditorKept
                tabId={tab.id}
                shown={tab.id === activeTabId || !!pane || !tab.path}
              >
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
                  readOnly={tabReadOnly(tab)}
                />
              </EditorKept>
            )}
          </div>
        );
      })}
      {split &&
        grid?.dividers.map(({ line, style }) => (
          <SplitDivider
            key={`${line.path.join(".")}:${line.index}`}
            layout={split}
            line={line}
            style={style}
            t={t}
          />
        ))}
    </main>
  );
}

/** Pane `id`'s sheet in the grid, taking in its row above as well. */
function withBarRow(grid: SplitGrid, id: string): CSSProperties | undefined {
  const sheet = grid.bodies.get(id);
  const row = String(grid.bars.get(id)?.gridRow ?? "").split(" / ")[0];
  const end = String(sheet?.gridRow ?? "").split(" / ")[1];
  return sheet && row && end ? { ...sheet, gridRow: `${row} / ${end}` } : sheet;
}

/** A document in the rendered editor: what the format bar formats. */
function formatsShown(tab: DocTab | undefined): boolean {
  return !!tab && !tab.view && !tab.sourceMode && !showsStartPage(tab);
}
