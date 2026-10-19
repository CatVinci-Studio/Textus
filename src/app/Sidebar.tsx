import { FileTree } from "../sidebar/FileTree";
import { Outline } from "../sidebar/Outline";
import { ClipboardHistory } from "../sidebar/ClipboardHistory";
import { ChatHistory } from "../sidebar/ChatHistory";
import {
  TreeTabIcon,
  OutlineTabIcon,
  ClipboardTabIcon,
  ChatTabIcon,
  FolderIcon,
} from "../ui/icons";
import { useSettings } from "../settings/SettingsContext";
import { isIOSApp } from "../platform/capabilities";
import { Presence, PresenceDiv, type PresenceHandle } from "../ui/usePresence";
import type { Strings } from "../i18n/strings";
import type { PanelMode } from "./useSidePanels";

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
  rootPath,
  openedFolder,
  onOpenFolder,
  onCloseFolder,
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
  rootPath: string | null;
  /** A folder the user opened: the tree starts there until it is closed. */
  openedFolder: string | null;
  onOpenFolder: () => void;
  onCloseFolder: () => void;
  activePath: string | null;
  activeContent: string;
  onToggle: () => void;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  t: Strings;
}) {
  const { settings } = useSettings();
  const zh = settings.language.startsWith("zh");
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
                    opened={!!openedFolder}
                    onOpenFolder={onOpenFolder}
                    onCloseFolder={onCloseFolder}
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
                  <div className="clipboard-empty tree-empty">
                    <p>{t.treeEmptyDraft}</p>
                    {!isIOSApp && (
                      <button
                        type="button"
                        className="tree-open-folder"
                        onClick={onOpenFolder}
                      >
                        <FolderIcon />
                        {zh ? "打开文件夹" : "Open folder"}
                      </button>
                    )}
                  </div>
                ))}
              {mode === "outline" && <Outline content={activeContent} />}
              {mode === "clipboard" && <ClipboardHistory />}
              {mode === "chat" && <ChatHistory />}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
