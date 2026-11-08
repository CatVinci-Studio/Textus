import { useReducer } from "react";
import { isIOSApp } from "../platform/capabilities";
import { Presence, PresenceDiv, type PresenceHandle } from "../ui/usePresence";
import { ResizeHandle } from "../ui/ResizeHandle";
import type { Strings } from "../i18n/strings";
import type { PanelMode } from "./useSidePanels";
import type { useSidebarWidth } from "./sidebar-width";
import type { OpenFolder } from "./useOpenFolder";
import { SidebarTabBar } from "./SidebarTabBar";
import { moveSidebarTab, sidebarTab, sidebarTabs } from "./sidebar-tabs";
import { ViewTitleActions } from "../plugins/views/plugin-views";

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
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  width: ReturnType<typeof useSidebarWidth>;
  openFolder: OpenFolder;
  activePath: string | null;
  activeContent: string;
  activeTabId: string;
  onToggle: () => void;
  onClose: () => void;
  /** `beside`: in a split beside the document in front. */
  onOpenFile: (path: string, beside?: boolean) => void;
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
  return (
    <>
      {/* iPhone: a tap beside the drawer closes it. */}
      <Presence show={isIOSApp && open} exitMs={250}>
        {isIOSApp && open && (
          <PresenceDiv className="sidebar-scrim" onClick={onToggle} />
        )}
      </Presence>
      <aside
        ref={presence.ref}
        aria-label={t.menuToggleSidebar}
        className={`sidebar ${open ? "" : "sidebar-collapsed"}`}
      >
        {/* Contents render only while open, and are inert while sliding
          away, so Tab can't land on a collapsed sidebar's buttons. */}
        {presence.mounted && (
          <>
            <div className="sidebar-header" inert={closing || undefined}>
              <SidebarTabBar
                tabs={sidebarTabs()}
                shownId={shown.id}
                onSelect={onModeChange}
                onMove={(id, target) => {
                  moveSidebarTab(id, target);
                  moved();
                }}
                t={t}
              />
            </div>
            <div className="sidebar-body" inert={closing || undefined}>
              <ViewTitleActions view={shown.id} />
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
