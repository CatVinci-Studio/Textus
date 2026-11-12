import { isPanelPane } from "./panel-pane";
import { Island } from "../../engine/layout/Island";
import { IslandArea, type IslandContent } from "../../engine/layout/IslandArea";
import { useChangedFiles } from "../../ai/chat/file-changes";
import { useAiFileMarks } from "../../ai/revision/file-revisions";
import { plural } from "../../i18n/plural";
import { DocumentCorners } from "./DocumentCorner";
import { DocumentViews } from "./DocumentViews";
import type { Lang } from "../../i18n/langs";
import { type ComponentProps, type CSSProperties } from "react";
import { usePhoneLayout } from "../../engine/controls/usePhoneLayout";
import {
  canDragTabsBetweenWindows,
  canUseWindows,
} from "../../platform/capabilities";
import {
  showsStartPage,
  tabIsDirty,
  tabTitle,
  tabTip,
  type DocTab,
} from "../../document/doc-tabs";
import { tabReadOnly } from "../../document/read-only";
import type { Strings } from "../../i18n/strings";
import type { TourAi } from "../../utils/events";
import type { AgentMode } from "../../prefs/SettingsContext";
import { TabBar } from "../../engine/controls/tabs/TabBar";
import { tabMenuItems } from "../tabs/tab-menu-items";
import { FormatBar } from "../FormatBar";
import { useIslands } from "../../engine/layout/useIslands";
import { panesOf, type Pane } from "../../engine/layout/tree";
import {
  focusPane,
  placeOnArrival,
  reorderInPane,
  windowTabs,
} from "../../engine/layout/store";
import { useTabsInBar } from "./tabs-in-bar";
import { pullTab } from "./tab-pull";
import { addFromTabRow, newConversation } from "./ai-tabs";
import { documentBesidePanels } from "./panel-add";
import type { ContextMenuItem } from "../../engine/controls/ContextMenu";
import { contributedContextItems } from "../../registry/context-menu-items";

type TabBarProps = ComponentProps<typeof TabBar>;

function pluginTabItems(
  path: string | null,
): (ContextMenuItem | "separator")[] {
  const added = contributedContextItems("tab/context", { path });
  return added.length ? ["separator", ...added] : [];
}

/** Panes named in reading order, for tests and styles to find. */
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];

/** The documents islands: each pane of open tabs an island, its tab row over
 *  its sheet, each tab's view on it - drawn by the engine's island area. */

export function DocumentIslands({
  tabs,
  activeTabId,
  showTabBar,
  onActivate,
  onClose,
  onAdd,
  onDetach,
  onMoveToNewWindow,
  onToggleReadOnly,
  onKeep,
  previewTab,
  onChange,
  typewriter,
  formatBar,
  tour,
  zen,
  lang,
  t,
}: {
  tabs: DocTab[];
  activeTabId: string;
  showTabBar: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  /** A blank document added; its tab's id. */
  onAdd: () => string;
  /** A tab pulled out of the window leaves for a window of its own (macOS). */
  onDetach: (tabId: string) => void;
  onMoveToNewWindow: (tabId: string) => void;
  onToggleReadOnly: (tabId: string) => void;
  /** A preview tab kept. */
  onKeep: (tabId: string) => void;
  previewTab: TabBarProps["previewTab"];
  /** Told, before paint, whether the top row has tabs: the window bar's
   *  then (App's data-tabs). */
  onChange: (tabId: string, markdown: string) => void;
  typewriter: boolean;
  /** View › Format Bar is on. */
  formatBar: boolean;
  /** The tour's practice tab, its AI and the AI panel mode its lesson
   *  needs, while the tour runs; else null. */
  tour: { tabId: string; ai: TourAi; mode: AgentMode | null } | null;
  /** Zen: no tabs, the documents plain paper. */
  zen: boolean;
  /** The interface's language: how a document's length is counted. */
  lang: Lang;
  t: Strings;
}) {
  // Files Textus AI changed: their tabs say so.
  const changed = useChangedFiles();
  const marks = useAiFileMarks();
  // Zen shows the tab in use alone; the split waits until Zen ends.
  const layout = useIslands(zen);
  const phone = usePhoneLayout();
  // A phone's column has its bar of its own, not islands.
  const islands = canUseWindows;
  const panes = panesOf(layout.root);
  // Each pane shows its tab in front; its place in reading order names it.
  const shownIn = new Map(
    panes.flatMap((p, i) =>
      p.front ? [[p.front, { id: p.id, name: ORDINALS[i] ?? `${i + 1}` }]] : [],
    ),
  );
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const tabsInBar = useTabsInBar(zen, showTabBar);
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
  // The window's tabs as they are now: a tab arriving is checked for room
  // before this renders it.
  const isPanel = (p: Pane) =>
    isPanelPane(
      p,
      (id) => windowTabs<DocTab>().find((tab) => tab.id === id)?.view,
    );
  // A document asked for from a panel's island opens apart from its pages.
  const addDocument = (pane: string) => {
    const from = panes.find((p) => p.id === pane);
    const id = onAdd();
    if (from && isPanel(from))
      placeOnArrival(id, documentBesidePanels(id, isPanel));
  };
  const tabBar = (
    list: DocTab[],
    active: string,
    pane: string,
    inner = false,
    style?: CSSProperties,
  ) => (
    <TabBar
      key={pane}
      style={style}
      paneId={pane}
      inner={inner}
      tabs={list.map((tab) => ({
        id: tab.id,
        title: tabTitle(tab, t),
        tip: tabTip(tab, t),
        dirty: tabIsDirty(tab),
        preview: tab.preview,
        path: tab.path,
        readOnly: tabReadOnly(tab),
        marked: !!tab.path && (changed.has(tab.path) || !!marks[tab.path]),
        waiting: (tab.path && marks[tab.path]?.pending) || undefined,
      }))}
      onUnlock={onToggleReadOnly}
      onKeep={onKeep}
      activeTabId={active}
      onActivate={onActivate}
      onClose={onClose}
      // Over a conversation, + starts another rather than a document.
      onAdd={() => {
        focusPane(pane);
        addFromTabRow(
          byId.get(active),
          () => addDocument(pane),
          newConversation,
        );
      }}
      // Pulled over the documents it splits; out of the window it tears
      // off where the platform gives global cursor positions.
      onPullOut={(id, title, e) =>
        pullTab(e, id, title, {
          activate: onActivate,
          detach: canDragTabsBetweenWindows ? onDetach : undefined,
          releaseOutside:
            canUseWindows && !canDragTabsBetweenWindows
              ? onMoveToNewWindow
              : undefined,
        })
      }
      onReorder={(id, index) => reorderInPane(pane, id, index)}
      previewTab={pane === panes[0]?.id ? previewTab : null}
      // Open beside and Move to New Window are drags (pullTab).
      menuFor={(id) => [
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
        waiting: (n) => plural(t.aiPendingCount, n, lang),
      }}
    />
  );

  const documents: IslandContent = (places) => {
    // The views lie on their island's sheet, placed by the area; a
    // phone's column lays its view out under its own bar.
    for (const { pane, place } of places)
      if (islands) cells.set(pane.id, tabsInBar ? place.sheet : place.whole);
    const listOf = (pane: Pane) =>
      pane.tabs.flatMap((id) => byId.get(id) ?? []);
    return (
      <>
        {/* Each pane of documents an island: its row of tabs over its
            sheet, its documents on the sheet (below). A phone's column has
            its own bar; a clean sheet is the page itself. */}
        {places.map(({ pane, place, key }) =>
          !islands
            ? tabBar(
                listOf(pane),
                pane.front ?? "",
                pane.id,
                place.inner,
                place.row,
              )
            : // Its sheet while it has a row, and in Zen with the tab bar
              // on; the tab bar off, the documents lie on the window.
              (tabsInBar || showTabBar) && (
                <Island
                  key={key}
                  frame={place.frame}
                  paneId={pane.id}
                  row={
                    tabsInBar
                      ? tabBar(
                          listOf(pane),
                          pane.front ?? "",
                          pane.id,
                          place.inner,
                        )
                      : undefined
                  }
                  rowStyle={place.row}
                  inner={place.inner}
                  sheetStyle={body(pane.id)}
                />
              ),
        )}
        {/* Each document's length at its page's corner. */}
        {islands && (
          <DocumentCorners
            fronts={places.map(({ pane, place }) => ({
              tab: byId.get(pane.front ?? ""),
              style: body(pane.id),
              frame: place.frame,
            }))}
            lang={lang}
            t={t}
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
          // On every island's document in front.
          above={(tab) =>
            formatBar &&
            !phone &&
            formatsShown(tab) && <FormatBar t={t} tabId={tab.id} />
          }
          t={t}
        />
      </>
    );
  };

  return (
    <IslandArea
      layout={layout}
      rows={tabsInBar}
      plain={!tabsInBar}
      // A panel's island holds pages only (the AI, Settings, a plugin's).
      isPanel={isPanel}
      content={documents}
      t={t}
    />
  );
}

/** A document in the rendered editor: what the format bar formats. */
function formatsShown(tab: DocTab | undefined): boolean {
  return !!tab && !tab.view && !tab.sourceMode && !showsStartPage(tab);
}
