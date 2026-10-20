import { FileTree } from "../sidebar/FileTree";
import { Outline } from "../sidebar/Outline";
import { ClipboardHistory } from "../sidebar/ClipboardHistory";
import { TreeTabIcon, OutlineTabIcon, ClipboardTabIcon } from "../ui/icons";
import { canOpenFolder, isIOSApp } from "../platform/capabilities";
import { Presence, PresenceDiv, type PresenceHandle } from "../ui/usePresence";
import { ResizeHandle } from "../ui/ResizeHandle";
import type { Strings } from "../i18n/strings";
import type { PanelMode } from "./useSidePanels";
import type { useSidebarWidth } from "./sidebar-width";
import type { OpenFolder } from "./useOpenFolder";
import { Tooltip } from "../ui/Tooltip";
import { PHONE_QUERY } from "../ui/usePhoneLayout";

/** The left sidebar (file tree, outline, clipboard history) and, on
 *  iPhone, the scrim behind its drawer. Its open state lives in
 *  useSidePanels. */
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
  onOpenFile: (path: string) => void;
  /** A file or folder was dragged into another folder in the tree. */
  onEntryMoved: (from: string, to: string) => void;
  /** The search shortcut asked for the Files tab's search box. */
  searchFocusRequest: boolean;
  onSearchFocusHandled: () => void;
  t: Strings;
}) {
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
                <Tooltip text={t.treeTab}>
                  <button
                    className={`sidebar-tab ${mode === "tree" ? "sidebar-tab-active" : ""}`}
                    onClick={() => onModeChange("tree")}
                    aria-label={t.treeTab}
                  >
                    <TreeTabIcon />
                  </button>
                </Tooltip>
                <Tooltip text={t.outlineTab}>
                  <button
                    className={`sidebar-tab ${mode === "outline" ? "sidebar-tab-active" : ""}`}
                    onClick={() => onModeChange("outline")}
                    aria-label={t.outlineTab}
                  >
                    <OutlineTabIcon />
                  </button>
                </Tooltip>
                <Tooltip text={t.clipboardTab}>
                  <button
                    className={`sidebar-tab ${mode === "clipboard" ? "sidebar-tab-active" : ""}`}
                    onClick={() => onModeChange("clipboard")}
                    aria-label={t.clipboardTab}
                  >
                    <ClipboardTabIcon />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="sidebar-body" inert={closing || undefined}>
              {mode === "tree" &&
                (openFolder.treeRoot ? (
                  <FileTree
                    root={openFolder.treeRoot}
                    onRootChange={openFolder.setTreeRoot}
                    folder={openFolder.folder}
                    activePath={activePath}
                    onFileSelect={(path) => {
                      // On a phone the drawer covers the page it just
                      // opened (mobile/styles); a docked one stays.
                      if (isIOSApp && window.matchMedia(PHONE_QUERY).matches)
                        onClose();
                      onOpenFile(path);
                    }}
                    onOpenFolder={
                      canOpenFolder ? openFolder.openFolderDialog : undefined
                    }
                    onCloseFolder={openFolder.closeFolder}
                    onEntryMoved={onEntryMoved}
                    searchFocusRequest={searchFocusRequest}
                    onSearchFocusHandled={onSearchFocusHandled}
                  />
                ) : (
                  // An unsaved draft has no folder - an empty panel read
                  // as broken. File > Open Folder… is the way to one; a
                  // button for it here sat oddly under the note.
                  <div className="clipboard-empty">{t.treeEmptyDraft}</div>
                ))}
              {mode === "outline" && <Outline content={activeContent} />}
              {mode === "clipboard" && <ClipboardHistory />}
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
