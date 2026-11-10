import { Island } from "../engine/layout/Island";
import {
  IslandArea,
  type IslandContent,
  type IslandPlace,
} from "../engine/layout/IslandArea";
import { useChangedFiles } from "../ai/chat/file-changes";
import { DocumentCorners } from "./islands/DocumentCorner";
import { DocumentViews } from "./islands/DocumentViews";
import type { Lang } from "../i18n/langs";
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
} from "react";
import { usePhoneLayout } from "../engine/controls/usePhoneLayout";
import {
  canDragTabsBetweenWindows,
  canUseWindows,
} from "../platform/capabilities";
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
import { TabBar } from "../engine/controls/tabs/TabBar";
import { tabMenuItems } from "./tabs/tab-menu-items";
import { FormatBar } from "./FormatBar";
import { useSplitPanes } from "../engine/layout/useSplitPanes";
import { islandOf, panesOf, type Pane } from "../engine/layout/tree";
import {
  focusPane,
  openBeside,
  reorderInPane,
  splitEditor,
} from "../engine/layout/store";
import { pullTab } from "./layout/split-drop";
import type { ContextMenuItem } from "../engine/controls/ContextMenu";
import { contributedContextItems } from "../engine/controls/context-menu-items";

type TabBarProps = ComponentProps<typeof TabBar>;

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
  aiIsland?: (place: IslandPlace) => ReactNode;
  /** Zen: no tabs, the documents plain paper (the AI island's beside them
   *  too). */
  zen: boolean;
  /** The interface's language: how a document's length is counted. */
  lang: Lang;
  t: Strings;
}) {
  // Files Textus AI changed: their tabs say so.
  const changed = useChangedFiles();
  const split = useSplitPanes(
    tabs.map((tab) => tab.id),
    activeTabId,
    onAdd,
  );
  const phone = usePhoneLayout();
  // A phone's column has its bar of its own, not islands.
  const islands = canUseWindows;
  const panes = split
    ? panesOf(split.root).filter((p) => islandOf(p) === "documents")
    : [];
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
  useLayoutEffect(() => onTabsInBar(tabsInBar), [tabsInBar, onTabsInBar]);
  // Each pane's sheet in the area's grid, as the area places them; without
  // its row, the sheet reaches up into the bar's.
  const cells = new Map<string, CSSProperties | undefined>();
  const body = (id: string) => cells.get(id);
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
        marked: !!tab.path && changed.has(tab.path),
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

  const documents: IslandContent = (places) => {
    for (const { pane, place } of places)
      if (pane) cells.set(pane.id, tabsInBar ? place.sheet : place.whole);
    const listOf = (pane: Pane) =>
      pane.tabs.flatMap((id) => byId.get(id) ?? []);
    return (
      <>
        {/* Each pane of documents an island: its row of tabs over its
            sheet, its documents on the sheet (below). A phone's column has
            its own bar; a clean sheet is the page itself. */}
        {places.map(({ pane, place }) =>
          !pane
            ? showTabBar &&
              (islands ? (
                <Island
                  key="window"
                  kind="documents"
                  row={tabBar(tabs, activeTabId, null)}
                />
              ) : (
                tabBar(tabs, activeTabId, null)
              ))
            : !islands
              ? tabBar(
                  listOf(pane),
                  pane.front ?? "",
                  pane.id,
                  place.inner,
                  place.row,
                )
              : tabsInBar && (
                  <Island
                    key={`island:${pane.id}`}
                    kind="documents"
                    paneId={pane.id}
                    row={tabBar(
                      listOf(pane),
                      pane.front ?? "",
                      pane.id,
                      place.inner,
                    )}
                    rowStyle={place.row}
                    inner={place.inner}
                    sheetStyle={body(pane.id)}
                  />
                ),
        )}
        {/* Each document's length at its page's corner. */}
        {islands && (
          <DocumentCorners
            fronts={places.map(({ pane }) => ({
              tab: byId.get(pane ? (pane.front ?? "") : activeTabId),
              style: pane ? body(pane.id) : undefined,
            }))}
            lang={lang}
            t={t}
          />
        )}
        {formatBar &&
          !docsSplit &&
          !phone &&
          formatsShown(byId.get(activeTabId)) && (
            <FormatBar
              t={t}
              // Beside the AI island, over the documents' sheet alone.
              style={panes[0] ? body(panes[0].id) : undefined}
            />
          )}
        <DocumentViews
          tabs={tabs}
          activeTabId={activeTabId}
          shownIn={shownIn}
          styleOf={body}
          onActivate={onActivate}
          onChange={onChange}
          typewriter={typewriter}
          tour={tour}
          t={t}
        />
      </>
    );
  };

  return (
    <IslandArea
      layout={split}
      plain={!tabsInBar}
      contents={{
        documents,
        ai:
          aiIsland && ((places) => places.map(({ place }) => aiIsland(place))),
      }}
      t={t}
    />
  );
}

/** A document in the rendered editor: what the format bar formats. */
function formatsShown(tab: DocTab | undefined): boolean {
  return !!tab && !tab.view && !tab.sourceMode && !showsStartPage(tab);
}
