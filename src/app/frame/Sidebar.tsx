import { useCallback, useReducer } from "react";
import { useSidebarFrame } from "./useSidebarFrame";
import { useSideToTop } from "../../engine/layout/useBarLayout";
import { isIOSApp } from "../../platform/capabilities";
import {
  Presence,
  PresenceDiv,
  type PresenceHandle,
} from "../../engine/motion/usePresence";
import { ResizeHandle } from "../../engine/controls/ResizeHandle";
import type { Strings } from "../../i18n/strings";
import type { SidebarTabId } from "./useSidePanels";
import type { useSidebarWidth } from "./sidebar-width";
import type { OpenFolder } from "../useOpenFolder";
import { SidebarTabBar } from "./SidebarTabBar";
import { ActivityRail } from "./ActivityRail";
import { useSettings } from "../../prefs/SettingsContext";
import {
  moveSidebarTab,
  railTabs,
  sidebarTab,
  sidebarTabs,
} from "./sidebar-tabs";
import { ViewTitleActions } from "../../plugins/views/plugin-views";
import type { FileOpenHow } from "../../files/tree-shared";

/** The left sidebar and its tabs, plus the scrim behind its drawer on iPhone. */
export function Sidebar({
  open,
  presence,
  closing,
  mode,
  onModeChange,
  width,
  openFolder,
  activePath,
  activeContent,
  activeTabId,
  onToggle,
  onClose,
  onOpenFile,
  onEntryMoved,
  searchFocusRequest,
  onSearchFocusHandled,
  t,
}: {
  open: boolean;
  presence: PresenceHandle;
  closing: boolean;
  mode: SidebarTabId;
  onModeChange: (mode: SidebarTabId) => void;
  width: ReturnType<typeof useSidebarWidth>;
  openFolder: OpenFolder;
  activePath: string | null;
  activeContent: string;
  activeTabId: string;
  onToggle: () => void;
  onClose: () => void;
  /** `beside`: in a split beside the document in front. */
  /** `line`: a line found in it, to go to (1-based). */
  onOpenFile: (path: string, how?: FileOpenHow, line?: number) => void;
  /** A file or folder was dragged into another folder in the tree. */
  onEntryMoved: (from: string, to: string) => void;
  /** The search shortcut asked for the Files tab's search box. */
  searchFocusRequest: boolean;
  onSearchFocusHandled: () => void;
  t: Strings;
}) {
  // The tab chosen, or Files for one no longer there.
  const shown = sidebarTab(mode);
  // A tab dragged: drawn again in its new order.
  const [, moved] = useReducer((n: number) => n + 1, 0);
  const { settings } = useSettings();
  // Under the window bar the header's line is covered: a plugin's buttons
  // for its panel go to the top of the panel instead.
  const titleShown = useSideToTop();
  const frame = useSidebarFrame(open, !isIOSApp, width.width);
  const presenceRef = presence.ref;
  const asideRef = useCallback(
    (el: HTMLElement | null) => {
      presenceRef(el);
      frame.current = el;
    },
    [presenceRef, frame],
  );
  // The phone opens the sidebar from its own bar; there is no rail there,
  // and an iPad's drawer has its tabs in a row at its top. The rail turned
  // off comes with the sidebar and goes with it.
  const rail = (settings.activityRail || open) && !isIOSApp;
  const move = (id: string, target: string) => {
    moveSidebarTab(id, target);
    moved();
  };
  return (
    <>
      {rail && (
        <ActivityRail
          tabs={railTabs()}
          shownId={shown.id}
          sidebarOpen={open}
          onSelect={(id) => {
            onModeChange(id);
            if (!open) onToggle();
          }}
          onCloseSidebar={onToggle}
          onReorder={moved}
          t={t}
        />
      )}
      {/* iPhone: a tap beside the drawer closes it. */}
      <Presence show={isIOSApp && open}>
        {isIOSApp && open && (
          <PresenceDiv className="sidebar-scrim" onClick={onToggle} />
        )}
      </Presence>
      <aside
        ref={asideRef}
        aria-label={t.menuToggleSidebar}
        className={`sidebar ${open ? "" : "sidebar-collapsed"}`}
      >
        {/* Contents render only while open, and are inert while sliding
          away, so Tab can't land on a collapsed sidebar's buttons. */}
        {presence.mounted && (
          <>
            {/* At the window's top it is the bar's row there: its bare
                room and its name move the window. */}
            <div
              className="sidebar-header"
              inert={closing || undefined}
              data-tauri-drag-region={titleShown || undefined}
            >
              {/* With the rail holding the tabs, the header is the panel's
                  name, on the window bar's line; the panel's own first row
                  (its search, its tools) starts under it, level with the
                  islands' tops. Without the rail its tabs are here. */}
              {/* A plugin's buttons for its panel (menus "view/title")
                  end the name's line: no row of their own. */}
              {!isIOSApp && (
                <>
                  <h2
                    className="tx-pane-title sidebar-title"
                    data-tauri-drag-region={titleShown || undefined}
                  >
                    {shown.label(t)}
                  </h2>
                  {titleShown && <ViewTitleActions view={shown.id} />}
                </>
              )}
              {isIOSApp && (
                <SidebarTabBar
                  tabs={sidebarTabs()}
                  shownId={shown.id}
                  onSelect={onModeChange}
                  onMove={move}
                  t={t}
                />
              )}
            </div>
            <div className="sidebar-body" inert={closing || undefined}>
              {(isIOSApp || !titleShown) && (
                <ViewTitleActions view={shown.id} />
              )}
              <shown.Panel
                t={t}
                openFolder={openFolder}
                activePath={activePath}
                activeContent={activeContent}
                activeTabId={activeTabId}
                onOpenFile={onOpenFile}
                onClose={onClose}
                onEntryMoved={onEntryMoved}
                searchFocusRequest={searchFocusRequest}
                onSearchFocusHandled={onSearchFocusHandled}
              />
            </div>
            {/* An iPad's sidebar keeps the width the layout gives it. */}
            {!isIOSApp && (
              <ResizeHandle
                className="sidebar-resizer"
                edge="right"
                width={width.width}
                min={width.min}
                max={width.max}
                onResize={width.setWidth}
                onReset={width.resetWidth}
                label={t.sidebarResize}
              />
            )}
          </>
        )}
      </aside>
    </>
  );
}
