import { viewKey } from "../../engine/frame/island-parts";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { EditorKept, KeptWhileHidden } from "./kept";
import { PageTabContent } from "../tabs/page-tabs";
import { useDocumentInFront } from "../tabs/useDocumentInFront";
import { EditorPane } from "../../document-view/EditorPane";
import { lazyModule } from "../../lazy/lazy-module";
import { lazyComponent } from "../../lazy/lazy-component";
import { DocSourceEditor } from "../../editor/modes/lazy-doc-source-editor";
import { showsStartPage, tabTitle, type DocTab } from "../../document/doc-tabs";
import { tabReadOnly } from "../../document/read-only";
import type { Strings } from "../../i18n/strings";
import type { TourAi } from "../../utils/events";
import type { AgentMode } from "../../prefs/SettingsContext";
import {
  PluginListPane,
  PluginTabPane,
  WebPagePane,
} from "../../plugins/views/plugin-views";
import { withPluginBlocks } from "../../document-view/plugins/plugin-code-blocks";

// Its Markdown renderer loads when a tab first shows it, not with the window.
// Shown only when the user chose it, so kept out of the startup chunk.
const StartPage = lazyComponent(
  // Loaded while the window is idle: on first use React holds a suspended
  // page back for 300ms, a pause between closing a document and the page.
  lazyModule("start-page", () => import("../StartPage"), { warm: true }),
  (m) => m.StartPage,
);
const SplitView = lazyComponent(
  lazyModule("split-view", () => import("../../editor/modes/SplitView")),
  (m) => m.SplitView,
);

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
  /** Where a pane's views lie; null: the one island unsplit's. Undefined
   *  where nothing places them (a phone's column). */
  styleOf: (paneId: string | null) => CSSProperties | undefined;
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
  const inFront = useDocumentInFront(tabs, activeTabId);
  return (
    <>
      {/* A document's editor is mounted while its tab is in front (or a
          draft with no file to come back from), else let go (EditorKept). */}
      {/* In a split, a click or focus in a pane brings its tab to the front. */}
      {tabs.map((tab) => {
        const pane = shownIn.get(tab.id);
        const single = !pane && tab.id === activeTabId && shownIn.size === 0;
        // On its island's sheet; a tab in none of them (one pulled away)
        // takes no room, in front or not.
        const placed = pane
          ? styleOf(pane.id)
          : single
            ? styleOf(null)
            : undefined;
        const shown = !!pane || (single && !!placed);
        return (
          <div
            key={tab.id}
            data-active-tab={tab.id === activeTabId}
            data-tab-id={tab.id}
            data-pane={pane?.name}
            data-pane-id={pane?.id}
            data-frame={shown ? viewKey(tab.id) : undefined}
            className={shown ? "split-pane" : undefined}
            style={shown ? placed : { display: single ? "contents" : "none" }}
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
            {shown && above?.(tab)}
            {tab.view?.kind === "page" ? (
              <KeptWhileHidden shown={tab.id === activeTabId || !!pane}>
                <PageTabContent tab={tab} />
              </KeptWhileHidden>
            ) : tab.view?.kind === "web" && tab.view.resource ? (
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
