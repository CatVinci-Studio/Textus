import { useSettings } from "../settings/SettingsContext";
import { ChatTabIcon, SidebarToggleIcon } from "../ui/icons";
import { WindowCaptionButtons } from "../ui/WindowCaptionButtons";
import type { MenuChecks } from "./app-menu-model";
import { AppMenuButton } from "./WindowControls";

/**
 * The window's top strip. It no longer spans the window: the two side
 * panels reach the window's top edge now, and this bar fills what is
 * left between them - the sidebar's tab row owns the left end, the AI
 * panel's header the right one, and this row holds the filename, the
 * document's status, and the drag area over the editor. App.tsx sets
 * --bar-strip-left / --bar-strip-right on the shell from the same state
 * the panels lay out from, so the bar's ends and the panels' edges are
 * one line (window-bar.css animates the left end with the sidebar's
 * slide).
 *
 * A real row in the layout, not an overlay - the overlay title bar hides
 * the native drag area behind the webview, so the app has to draw this
 * itself, and drawing it as a transparent fixed strip meant the document
 * scrolled underneath and the filename sat on top of the text. It is
 * still the drag region (both for moving the window and for the
 * drag-to-merge gesture in useTabDragMerge).
 *
 * The window's own corners stay the window's on every platform: the
 * menu button and the sidebar toggle are pinned to the left corner
 * (they must not slide while the sidebar arrives beside them), and
 * where the OS draws no caption (Windows, Linux) the minimize /
 * maximize / close buttons are pinned to the right one. Both are
 * children of this row so they fade with it in zen mode, and render
 * nothing where the platform supplies its own frame. See
 * platform/window-chrome.ts.
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
      {/* The window's left corner, pinned rather than laid out in the
        row: with the sidebar open its header shares this strip, and the
        corner's controls have to stay put while the sidebar slides in
        beside them. data-tauri-drag-region on the cluster itself, not
        just the row: a click on its empty gaps must still drag the
        window, and Tauri only asks the event's own target. */}
      <div className="window-bar-left" data-tauri-drag-region>
        <AppMenuButton checks={menuChecks} />
        <button
          type="button"
          className={`window-bar-sidebar-toggle${sidebarOpen ? " window-bar-sidebar-toggle-on" : ""}`}
          aria-pressed={sidebarOpen}
          aria-label={t.sidebarPanelToggle}
          title={`${t.sidebarPanelToggle} (${sidebarShortcut})`}
          onClick={onToggleSidebar}
        >
          <SidebarToggleIcon />
        </button>
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
            aria-label={t.agentPanelToggle}
            title={`${t.agentPanelToggle} (${agentShortcut})`}
            onClick={onToggleAgent}
          >
            <ChatTabIcon />
          </button>
        )}
      </div>
      <WindowCaptionButtons />
    </header>
  );
}
