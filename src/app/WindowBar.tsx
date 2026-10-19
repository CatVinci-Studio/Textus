import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { canToggleFullscreen } from "../platform/capabilities";
import { appDrawsWindowFrame } from "../platform/window-chrome";
import { useSettings } from "../settings/SettingsContext";
import { ChatTabIcon, TreeTabIcon } from "../ui/icons";
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
  showAgentToggle,
  agentOpen,
  agentShortcut,
  onToggleAgent,
  sidebarOpen,
  sidebarShortcut,
  onToggleSidebar,
}: {
  menuChecks: MenuChecks;
  title: string;
  dirty: boolean;
  largeDoc: boolean;
  words: number;
  showAgentToggle: boolean;
  agentOpen: boolean;
  /** The AI panel's shortcut, as shown in the button's tooltip. */
  agentShortcut: string;
  onToggleAgent: () => void;
  /** The files sidebar (Write only - Agent hides it, window-bar.css). */
  sidebarOpen: boolean;
  sidebarShortcut: string;
  onToggleSidebar: () => void;
}) {
  const { t } = useSettings();
  const fullscreen = useNativeFullscreen();
  return (
    <header
      className="window-bar"
      data-fullscreen={fullscreen || undefined}
      data-tauri-drag-region
    >
      <AppMenuButton checks={menuChecks} />
      {/* The active document's surface controls are portalled here
        (MilkdownEditor): the Agent | 写作 switch leads, then the files
        sidebar's button; read-aloud sits by the chat. */}
      <span className="window-bar-start" />
      <button
        type="button"
        className={`window-bar-sidebar${sidebarOpen ? " is-on" : ""}`}
        aria-pressed={sidebarOpen}
        aria-label={t.shortcutToggleSidebar}
        title={`${t.shortcutToggleSidebar} (${sidebarShortcut})`}
        onClick={onToggleSidebar}
      >
        <TreeTabIcon />
      </button>
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
        <span className="window-bar-end" />
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

/**
 * Whether a macOS window is in full screen, where the traffic lights are
 * hidden and the bar's left inset for them would only push "← Agent" off
 * the left edge. Where the app draws its own frame there is no inset.
 */
function useNativeFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!canToggleFullscreen || appDrawsWindowFrame) return;
    let alive = true;
    let win: ReturnType<typeof getCurrentWindow>;
    try {
      win = getCurrentWindow();
    } catch {
      return; // No window to ask (a test, the dev shim).
    }
    const sync = () => {
      void win
        .isFullscreen()
        .then((on) => {
          if (alive) setFullscreen(on === true);
        })
        .catch(() => {});
    };
    sync();
    // Entering or leaving full screen resizes the window; only where the
    // animation ends matters.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const unlisten = win.onResized(() => {
      clearTimeout(settle);
      settle = setTimeout(sync, 100);
    });
    return () => {
      alive = false;
      clearTimeout(settle);
      void unlisten.then((off) => off()).catch(() => {});
    };
  }, []);
  return fullscreen;
}
