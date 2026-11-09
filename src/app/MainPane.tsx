import { IslandFrame } from "./layout/IslandFrame";
import { useKeptLoaded } from "../utils/kept-loaded";
import { editorHeld } from "../document/editor-held";
import type { ReactNode } from "react";
import {
  type ComponentProps,
  type CSSProperties,
  Suspense,
  useLayoutEffect,
  useRef,
} from "react";
import { useTabRows } from "./layout/useTabRows";
import { usePhoneLayout } from "../ui/usePhoneLayout";
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
import { FormatBar } from "./FormatBar";
import { useSplitPanes } from "./split/useSplitPanes";
import { SplitDivider } from "./split/SplitDivider";
import { panesOf, splitGrid } from "./split/split-tree";
import "./split/split-panes.css";
import {
  focusPane,
  openBeside,
  reorderInPane,
  splitEditor,
} from "./split/split-layout";
import { pullTab } from "./split/split-drop";
import type { ContextMenuItem } from "../ui/ContextMenu";
import { contributedContextItems } from "../ui/context-menu-items";
import { pathItems } from "../clipboard/copy-path";
import { windowFolder } from "../platform/window-folder";
import { isWithin } from "../sidebar/tree-root";
import { SHOW_SIDEBAR_TAB_EVENT } from "../utils/events";
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

/** A plugin's page in a tab out of sight is let go after a while (three
 *  at most kept); shown again, it loads afresh, its saved state restored. */
function KeptWhileHidden({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}) {
  return useKeptLoaded("plugin-view", shown) ? children : null;
}

/** A document's editor out of sight ten minutes is let go, unless Textus
 *  AI or undecided changes live in it, or it has no file to come back
 *  from; shown again, it opens at its text with its undo history. */
const EDITOR_HIDDEN_MS = 10 * 60_000;

function EditorKept({
  tabId,
  shown,
  children,
}: {
  tabId: string;
  shown: boolean;
  children: ReactNode;
}) {
  const loaded = useKeptLoaded("editor", shown, {
    hiddenMs: EDITOR_HIDDEN_MS,
    max: Infinity,
    hold: () => editorHeld(tabId),
  });
  return loaded ? children : null;
}

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
  const grid = split && splitGrid(split.root);
  const panes = split ? panesOf(split.root) : [];
  // Each pane shows its tab in front; its place in reading order names it.
  const shownIn = new Map(
    panes.flatMap((p, i) =>
      p.front ? [[p.front, { id: p.id, name: ORDINALS[i] ?? `${i + 1}` }]] : [],
    ),
  );
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  // A split's top panes always have their tabs; one pane, when shown.
  const tabsInBar = !!split || showTabBar;
  useLayoutEffect(() => onTabsInBar(tabsInBar), [tabsInBar, onTabsInBar]);
  // The saved tabs close; one with unsaved changes stays, its dot showing,
  // rather than a prompt for each.
  const closeSaved = (list: DocTab[]) => {
    const closing = list.filter((tab) => !tabIsDirty(tab));
    // The tab in front closing too: one that stays comes forward first, as
    // each close would otherwise pick a neighbour that is closing as well.
    if (closing.some((tab) => tab.id === activeTabId)) {
      const stays = tabs.find((tab) => !closing.includes(tab));
      if (stays) onActivate(stays.id);
    }
    for (const tab of closing) onClose(tab.id);
  };
  // Its path three ways, and the file found in the tree when the open
  // folder holds it.
  const pathItem = (id: string, path: string | null | undefined) => {
    if (!path) return [];
    const folder = windowFolder();
    const inTree = folder !== null && isWithin(path, folder);
    return [
      ...pathItems(t, path, folder),
      ...(inTree
        ? [{ label: t.menuRevealInTree, onSelect: () => revealInTree(id) }]
        : []),
    ];
  };
  const revealInTree = (id: string) => {
    onActivate(id);
    window.dispatchEvent(
      new CustomEvent(SHOW_SIDEBAR_TAB_EVENT, { detail: "tree" }),
    );
    // Once the tree has opened down to it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .querySelector('.sidebar .tree-row[aria-selected="true"]')
          ?.scrollIntoView({ block: "nearest" }),
      ),
    );
  };
  const readOnlyItem = (id: string) => {
    const tab = byId.get(id);
    if (!tab || tab.view) return [];
    return [
      {
        label: t.menuToggleReadOnly,
        checked: tabReadOnly(tab),
        onSelect: () => onToggleReadOnly(id),
      },
    ];
  };
  const closeManyItems = (list: DocTab[], id: string) => {
    const at = list.findIndex((tab) => tab.id === id);
    const groups: [string, DocTab[]][] = [
      [t.closeOtherTabs, list.filter((tab) => tab.id !== id)],
      [t.closeTabsToLeft, list.slice(0, at)],
      [t.closeTabsToRight, list.slice(at + 1)],
    ];
    return [
      ...groups
        .filter(([, closing]) => closing.length > 0)
        .map(([label, closing]) => ({
          label,
          onSelect: () => closeSaved(closing),
        })),
      { label: t.menuCloseSaved, onSelect: () => closeSaved(list) },
      // Each asks, as its own close does, when it has unsaved changes.
      {
        label: t.menuCloseAll,
        onSelect: () => list.forEach((tab) => onClose(tab.id)),
      },
    ];
  };
  const tabBar = (
    list: DocTab[],
    active: string,
    pane: string | null,
    style?: CSSProperties,
    inner = false,
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
      }))}
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
            id === activeTabId && !split
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
      {/* Each pane's island, under its documents (layout.css). */}
      {split && grid ? (
        panes.map((p) => (
          <IslandFrame
            key={`island:${p.id}`}
            paneId={p.id}
            style={grid.bodies.get(p.id)}
          />
        ))
      ) : (
        <IslandFrame paneId={null} />
      )}
      {split && grid
        ? panes.map((p) =>
            tabBar(
              p.tabs.flatMap((id) => byId.get(id) ?? []),
              p.front ?? "",
              p.id,
              grid.bars.get(p.id),
              !grid.top.has(p.id),
            ),
          )
        : showTabBar && tabBar(tabs, activeTabId, null)}
      {formatBar && !split && !phone && formatsShown(byId.get(activeTabId)) && (
        <FormatBar t={t} />
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
                ? grid.bodies.get(pane.id)
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

/** A document in the rendered editor: what the format bar formats. */
function formatsShown(tab: DocTab | undefined): boolean {
  return !!tab && !tab.view && !tab.sourceMode && !showsStartPage(tab);
}
