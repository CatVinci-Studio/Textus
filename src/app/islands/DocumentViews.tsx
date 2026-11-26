import { viewKey } from "../../engine/frame/island-parts";
import { tabZoomStyle } from "../../engine/zoom/tab-zoom";
import { Suspense, useRef, type CSSProperties, type ReactNode } from "react";
import { EditorKept, KeptWhileHidden } from "./kept";
import { userHasActed } from "./user-input";
import { PageTabContent } from "../tabs/page-tabs";
import { useDocumentInFront } from "../tabs/useDocumentInFront";
import { EditorPane } from "../../document-view/EditorPane";
import { SourceTabView } from "./SourceTabView";
import { lazyComponent } from "../../lazy/lazy-component";
import { startPageModule } from "../start-page-module";
import { showsStartPage, tabTitle, type DocTab } from "../../document/doc-tabs";
import { tabReadOnly } from "../../document/read-only";
import type { Strings } from "../../i18n/strings";
import type { TourAi } from "../../utils/events";
import { useSettingsIfAny, type AgentMode } from "../../prefs/SettingsContext";
import {
  PluginListPane,
  PluginTabPane,
  WebPagePane,
} from "../../plugins/views/plugin-views";
import { setPreviewExtras } from "../../editor/preview-extras";
import { textFileOf } from "../../files/document-name";

// Every preview draws what plugins draw (a chart, a board, their inline
// syntax), as documents do.
setPreviewExtras(() =>
  import("../../document-view/plugins/plugin-code-blocks").then(
    (m) => m.withPluginBlocks,
  ),
);

const StartPage = lazyComponent(startPageModule, (m) => m.StartPage);

/**
 * `tabs` in the order they opened, whatever order the tab row puts them in.
 * Each view is placed by its island, so the list's order means nothing on
 * screen; but a view React moves to follow a new order is taken out of the
 * page and put back, which loses its scroll position.
 */
function useOpeningOrder(tabs: DocTab[]): DocTab[] {
  const order = useRef<string[]>([]);
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const kept = order.current.filter((id) => byId.has(id));
  const known = new Set(kept);
  order.current = [
    ...kept,
    ...tabs.filter((tab) => !known.has(tab.id)).map((tab) => tab.id),
  ];
  return order.current.map((id) => byId.get(id)!);
}

/**
 * Every open tab's view - its editor, source, split view, plugin view, web
 * page or start page - laid on its island's sheet: those in front of a pane
 * in that pane's cell (`shownIn`, `styleOf`), the rest hidden but kept, so
 * switching back keeps their state.
 */
export function DocumentViews({
  tabs,
  activeTabId,
  shownIn,
  styleOf,
  onActivate,
  onChange,
  typewriter,
  tour,
  above,
  t,
}: {
  tabs: DocTab[];
  activeTabId: string;
  /** The tabs in front of a pane: its id and its name in reading order. */
  shownIn: ReadonlyMap<string, { id: string; name: string }>;
  /** Where an island's views lie; undefined where nothing places them (a
   *  phone's column). */
  styleOf: (paneId: string) => CSSProperties | undefined;
  onActivate: (tabId: string) => void;
  onChange: (tabId: string, markdown: string) => void;
  typewriter: boolean;
  tour: { tabId: string; ai: TourAi; mode: AgentMode | null } | null;
  /** What tops each island's document in front, riding with it (the
   *  format bar). */
  above?: (tab: DocTab) => ReactNode;
  t: Strings;
}) {
  // The document in front is the AI's and draws the margin, even with an
  // AI tab or a page tab active.
  const inFront = useDocumentInFront();
  const listed = useOpeningOrder(tabs);
  // Read when an editor is made (editor-core-syntax): a change remounts the
  // documents, each with its text as it stands.
  const singleTilde = useSettingsIfAny()?.settings.singleTilde;
  return (
    <>
      {/* A document's editor is mounted while its tab is in front (or a
          draft with no file to come back from), else let go (EditorKept). */}
      {/* In a split, a click or focus in a pane brings its tab to the front. */}
      {listed.map((tab) => {
        const pane = shownIn.get(tab.id);
        // On its island's sheet; a phone's column lays it out in its own
        // flow; a tab in no island (one pulled away) takes no room.
        const placed = pane && styleOf(pane.id);
        const shown = !!placed;
        return (
          <div
            key={tab.id}
            data-active-tab={tab.id === activeTabId}
            data-tab-id={tab.id}
            data-pane={pane?.name}
            data-pane-id={pane?.id}
            data-frame={shown ? viewKey(tab.id) : undefined}
            className={shown ? "split-pane" : undefined}
            style={
              shown
                ? { ...placed, ...tabZoomStyle(tab.id) }
                : { display: pane ? "contents" : "none" }
            }
            onPointerDownCapture={
              pane && tab.id !== activeTabId
                ? () => onActivate(tab.id)
                : undefined
            }
            onFocusCapture={
              pane && tab.id !== activeTabId
                ? () => userHasActed() && onActivate(tab.id)
                : undefined
            }
          >
            {shown && above?.(tab)}
            {tab.view?.kind === "page" ? (
              <KeptWhileHidden shown={tab.id === activeTabId || !!pane}>
                <PageTabContent tab={tab} />
              </KeptWhileHidden>
            ) : tab.view?.kind === "web" && tab.view.resource ? (
              <WebPagePane
                tabId={tab.id}
                url={tab.view.resource}
                shown={tab.id === activeTabId || !!pane}
                t={t}
              />
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
            ) : tab.sourceMode || textFileOf(tab.path) ? (
              <KeptWhileHidden
                shown={tab.id === activeTabId || !!pane}
                kind="source-view"
              >
                <SourceTabView
                  tab={tab}
                  isActive={tab.id === inFront}
                  typewriter={typewriter}
                  onChange={onChange}
                />
              </KeptWhileHidden>
            ) : (
              <EditorKept
                tabId={tab.id}
                // An edited untitled draft has no file to come back from
                // with its undo; a blank one or a guide does.
                shown={
                  tab.id === activeTabId ||
                  !!pane ||
                  (!tab.path && tab.content !== tab.savedContent)
                }
              >
                <EditorPane
                  key={`${tab.id}-${tab.reloadKey}-${singleTilde}`}
                  tabId={tab.id}
                  filePath={tab.path}
                  docTitle={tabTitle(tab, t)}
                  initialValue={tab.content}
                  onChange={onChange}
                  isActive={tab.id === inFront}
                  tour={tour && tab.id === tour.tabId ? tour.ai : null}
                  tourMode={tour && tab.id === tour.tabId ? tour.mode : null}
                  readOnly={tabReadOnly(tab)}
                />
              </EditorKept>
            )}
          </div>
        );
      })}
    </>
  );
}
