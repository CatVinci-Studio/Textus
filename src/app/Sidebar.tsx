import { FileTree } from "../sidebar/FileTree";
import { Outline } from "../sidebar/Outline";
import { ClipboardHistory } from "../sidebar/ClipboardHistory";
import { ChatHistory } from "../sidebar/ChatHistory";
import {
  TreeTabIcon,
  OutlineTabIcon,
  ClipboardTabIcon,
  ChatTabIcon,
} from "../ui/icons";
import { isIOSApp } from "../platform/capabilities";
import { Presence, PresenceDiv, type PresenceHandle } from "../ui/usePresence";
import { ResizeHandle } from "../ui/ResizeHandle";
import type { Strings } from "../i18n/strings";
import type { PanelMode } from "./useSidePanels";
import type { useSidebarWidth } from "./sidebar-width";

/** The left sidebar (file tree, outline, clipboard, chat history) and, on
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
  rootPath,
  activePath,
  activeContent,
  onToggle,
  onClose,
  onOpenFile,
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
  rootPath: string | null;
  activePath: string | null;
  activeContent: string;
  onToggle: () => void;
  onClose: () => void;
  onOpenFile: (path: string) => void;
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
                <button
                  className={`sidebar-tab ${mode === "tree" ? "sidebar-tab-active" : ""}`}
                  onClick={() => onModeChange("tree")}
                  title={t.treeTab}
                  aria-label={t.treeTab}
                >
                  <TreeTabIcon />
                </button>
                <button
                  className={`sidebar-tab ${mode === "outline" ? "sidebar-tab-active" : ""}`}
                  onClick={() => onModeChange("outline")}
                  title={t.outlineTab}
                  aria-label={t.outlineTab}
                >
                  <OutlineTabIcon />
                </button>
                <button
                  className={`sidebar-tab ${mode === "clipboard" ? "sidebar-tab-active" : ""}`}
                  onClick={() => onModeChange("clipboard")}
                  title={t.clipboardTab}
                  aria-label={t.clipboardTab}
                >
                  <ClipboardTabIcon />
                </button>
                <button
                  className={`sidebar-tab ${mode === "chat" ? "sidebar-tab-active" : ""}`}
                  onClick={() => onModeChange("chat")}
                  title={t.chatTab}
                  aria-label={t.chatTab}
                >
                  <ChatTabIcon />
                </button>
              </div>
            </div>
            <div className="sidebar-body" inert={closing || undefined}>
              {mode === "tree" &&
                (rootPath ? (
                  <FileTree
                    key={rootPath}
                    rootPath={rootPath}
                    activePath={activePath}
                    onFileSelect={(path) => {
                      // On a phone the drawer covers the page it just
                      // opened (mobile/styles); a docked one stays.
                      if (
                        isIOSApp &&
                        window.matchMedia("(max-width: 760px)").matches
                      )
                        onClose();
                      onOpenFile(path);
                    }}
                  />
                ) : (
                  // An unsaved draft has no folder - an empty panel read
                  // as broken.
                  <div className="clipboard-empty">{t.treeEmptyDraft}</div>
                ))}
              {mode === "outline" && <Outline content={activeContent} />}
              {mode === "clipboard" && <ClipboardHistory />}
              {mode === "chat" && <ChatHistory />}
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
