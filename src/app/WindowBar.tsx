import { isIOSApp } from "../platform/capabilities";
import { useSettings } from "../settings/SettingsContext";
import { AssistantIcon, SidebarToggleIcon } from "../ui/icons";
import { WindowCaptionButtons } from "../ui/WindowCaptionButtons";
import type { MenuChecks } from "./app-menu-model";
import { AppMenuButton } from "./WindowControls";

/**
 * The window's one top strip: traffic-light room, which document this
 * is, and its status. A real row in the layout, not an overlay - the
 * overlay title bar hides the native drag area behind the webview, so
 * the app has to draw this itself, and drawing it as a transparent
 * fixed strip meant the document scrolled underneath and the filename
 * sat on top of the text. It is also the drag region (both for moving
 * the window and for the drag-to-merge gesture in useTabDragMerge).
 *
 * On the desktop the sidebar reaches the window's top edge and lies over
 * this row's left end, its tabs in the strip (sidebar-frame.css). The
 * row's own controls - the sidebar's toggle, then the app menu - ride
 * just past its edge while it is open, and the title centres over what
 * is left (window-bar.css).
 *
 * Where the OS supplies no frame at all (Windows), this same row is
 * ALSO the caption and the way into the app menu - the two components
 * below render nothing anywhere else, so this stays one strip on
 * every platform. See platform/window-chrome.ts.
 */
export function WindowBar({
  menuChecks,
  title,
  dirty,
  largeDoc,
  words,
  sidebarOpen,
  sidebarShortcut,
  onToggleSidebar,
  showAgentToggle,
  agentOpen,
  agentShortcut,
  onToggleAgent,
}: {
  menuChecks: MenuChecks;
  title: string;
  dirty: boolean;
  largeDoc: boolean;
  words: number;
  sidebarOpen: boolean;
  /** The sidebar's shortcut, as shown in the button's tooltip. */
  sidebarShortcut: string;
  onToggleSidebar: () => void;
  showAgentToggle: boolean;
  agentOpen: boolean;
  /** The AI panel's shortcut, as shown in the button's tooltip. */
  agentShortcut: string;
  onToggleAgent: () => void;
}) {
  const { t } = useSettings();
  return (
    <header
      className={`window-bar${sidebarOpen ? " window-bar-sidebar-open" : ""}`}
      data-tauri-drag-region
    >
      {/* A drag region of its own: Tauri asks only the event's target, and
        a press between the two buttons should still move the window. */}
      <div className="window-bar-left" data-tauri-drag-region>
        {/* The phone and the iPad open the sidebar from the menu. */}
        {!isIOSApp && (
          <button
            type="button"
            className={`window-bar-sidebar-toggle${sidebarOpen ? " window-bar-sidebar-toggle-on" : ""}`}
            aria-pressed={sidebarOpen}
            aria-label={t.menuToggleSidebar}
            title={`${t.menuToggleSidebar} (${sidebarShortcut})`}
            onClick={onToggleSidebar}
          >
            <SidebarToggleIcon />
          </button>
        )}
        <AppMenuButton checks={menuChecks} />
      </div>
      {/* The unsaved dot leads the title, as a native edited-document
        title does - in the status group it sat on top of a long title
        on a narrow window. */}
      <span className="window-bar-title">
        {dirty && <span className="unsaved-dot" title={t.unsavedIndicator} />}
        <span className="window-bar-title-text">{title}</span>
      </span>
      <div className="window-bar-status">
        {largeDoc && (
          <span className="large-doc-badge" title={t.largeDocHint}>
            {t.largeDocBadge}
          </span>
        )}
        <span className="word-count">
          {words > 0 && `${words} ${t.wordsUnit}`}
        </span>
        {showAgentToggle && (
          <button
            type="button"
            className={`window-bar-toggle${agentOpen ? " window-bar-toggle-on" : ""}`}
            aria-pressed={agentOpen}
            aria-label={t.agentPanelTitle}
            title={`${t.agentPanelTitle} (${agentShortcut})`}
            onClick={onToggleAgent}
          >
            <AssistantIcon />
          </button>
        )}
      </div>
      <WindowCaptionButtons />
    </header>
  );
}
