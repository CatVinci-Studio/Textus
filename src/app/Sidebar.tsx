import { isIOSApp } from "../platform/capabilities";
import { Presence, PresenceDiv, type PresenceHandle } from "../ui/usePresence";
import { ResizeHandle } from "../ui/ResizeHandle";
import type { Strings } from "../i18n/strings";
import type { PanelMode } from "./useSidePanels";
import type { useSidebarWidth } from "./sidebar-width";
import type { OpenFolder } from "./useOpenFolder";
import { Tooltip } from "../ui/Tooltip";
import { sidebarTab, sidebarTabs } from "./sidebar-tabs";
import { ViewTitleActions } from "../plugins/views/plugin-views";

/** The left sidebar - its tabs (sidebar-tabs.tsx: the file tree, the
 *  outline, the clipboard history) - and, on iPhone, the scrim behind its
 *  drawer. Its open state lives in useSidePanels. */
export function Sidebar({
  open,
  presence,
  closing,
  spotlight,
  mode,
  onModeChange,
  width,
  openFolder,
  activePath,
  activeContent,
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
  /** The tour's sidebar lesson is on. */
  spotlight: boolean;
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  width: ReturnType<typeof useSidebarWidth>;
  /** The tree's root and the opened folder (useOpenFolder.ts). */
  openFolder: OpenFolder;
  activePath: string | null;
  activeContent: string;
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
  return (
    <>
      {/* iPhone: the sidebar is a drawer over the page (mobile/styles),
        and a tap beside it closes it. */}
      <Presence show={isIOSApp && open} exitMs={250}>
        {isIOSApp && open && (
          <PresenceDiv className="sidebar-scrim" onClick={onToggle} />
        )}
      </Presence>
      <aside
        ref={presence.ref}
        aria-label={t.menuToggleSidebar}
        className={`sidebar ${open ? "" : "sidebar-collapsed"} ${spotlight ? "tutorial-spotlight" : ""}`}
      >
        {/* Contents only render while open (and inert while the sidebar
          slides away) - a collapsed sidebar is just moved out of view,
          not unmounted, so without this its buttons/tree would stay in
          the tab order and Tab could land focus on them from the
          editor. */}
        {presence.mounted && (
          <>
            <div className="sidebar-header" inert={closing || undefined}>
              <div className="sidebar-tabs">
                {sidebarTabs().map(({ id, label, Icon }) => (
                  <Tooltip key={id} text={label(t)}>
                    <button
                      className={`sidebar-tab ${shown.id === id ? "sidebar-tab-active" : ""}`}
                      onClick={() => onModeChange(id)}
                      aria-label={label(t)}
                    >
                      <Icon />
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
            <div className="sidebar-body" inert={closing || undefined}>
              <ViewTitleActions view={shown.id} />
              <shown.Panel
                t={t}
                openFolder={openFolder}
                activePath={activePath}
                activeContent={activeContent}
                onOpenFile={onOpenFile}
                onClose={onClose}
                onEntryMoved={onEntryMoved}
                searchFocusRequest={searchFocusRequest}
                onSearchFocusHandled={onSearchFocusHandled}
              />
            </div>
            {/* Its width is the user's to drag on a desktop; an iPad's
              sidebar keeps the one the layout gives it. */}
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
