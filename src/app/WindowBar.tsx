import { Fragment, useSyncExternalStore } from "react";
import { useSettings } from "../settings/SettingsContext";
import { WindowCaptionButtons } from "../ui/WindowCaptionButtons";
import type { MenuChecks } from "./app-menu-model";
import { AppMenuButton } from "./WindowControls";
import { MenuBar } from "./MenuBar";
import { appDrawsWindowFrame } from "../platform/window-chrome";
import { Tooltip } from "../ui/Tooltip";
import { TextusAiButton } from "../ai/TextusAiSwitch";
import { isIOSApp } from "../platform/capabilities";
import { SidebarToggleIcon } from "../ui/icons";
import { useFullscreenMark } from "./useFullscreenMark";
import { runCommand } from "./commands";
import {
  statusItemsSnapshot,
  subscribeStatusItems,
} from "../plugins/status-items";

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
 *
 * The sidebar's toggle leads the row: just past the traffic lights on a
 * Mac, in their corner once they are gone in full screen, beside the menu
 * button on Windows and Linux. It belongs to the bar, not the sidebar, so
 * the sidebar's slide never moves it. With the menu bar shown there
 * (Settings.menuBarShown) the titles take its room: the sidebar is in
 * View, and has its shortcut.
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
  /** The AI panel can be opened: Textus AI is on, and so is its chat. */
  showAgentToggle: boolean;
  agentOpen: boolean;
  /** The AI panel's shortcut, as shown in the button's tooltip. */
  agentShortcut: string;
  onToggleAgent: () => void;
}) {
  const { t, settings } = useSettings();
  useFullscreenMark();
  const menuBar = appDrawsWindowFrame && settings.menuBarShown;
  return (
    <header className="window-bar" data-tauri-drag-region>
      {menuBar ? (
        <>
          <MenuBar checks={menuChecks} />
          {/* For a window too narrow for the titles (window-controls.css). */}
          <span className="window-menu-fallback">
            <AppMenuButton checks={menuChecks} />
          </span>
        </>
      ) : (
        <AppMenuButton checks={menuChecks} />
      )}
      {/* The iPhone and the iPad open the sidebar from their own bar. */}
      {!isIOSApp && !menuBar && (
        <Tooltip text={`${t.menuToggleSidebar} (${sidebarShortcut})`}>
          <button
            type="button"
            className="window-bar-sidebar-toggle"
            aria-pressed={sidebarOpen}
            aria-label={t.menuToggleSidebar}
            onClick={onToggleSidebar}
          >
            <SidebarToggleIcon />
          </button>
        </Tooltip>
      )}
      {/* The unsaved dot leads the title, as a native edited-document
        title does - in the status group it sat on top of a long title
        on a narrow window. */}
      <span className="window-bar-title">
        {dirty && (
          <Tooltip text={t.unsavedIndicator}>
            <span
              className="unsaved-dot"
              role="img"
              aria-label={t.unsavedIndicator}
            />
          </Tooltip>
        )}
        <span className="window-bar-title-text">{title}</span>
      </span>
      <div className="window-bar-status">
        <PluginStatusItems />
        {largeDoc && (
          <span className="large-doc-badge" title={t.largeDocHint}>
            {t.largeDocBadge}
          </span>
        )}
        <span className="word-count">
          {words > 0 && `${words} ${t.wordsUnit}`}
        </span>
        {/* Textus AI's one button: the AI panel, struck through while
          Textus AI is off; right-click pauses or turns it off (#196). */}
        <TextusAiButton
          className="window-bar-toggle"
          panelOpen={agentOpen}
          showPanel={showAgentToggle}
          shortcut={agentShortcut}
          onTogglePanel={onToggleAgent}
        />
      </div>
      <WindowCaptionButtons />
    </header>
  );
}

/** What plugins show here (window.setStatusItem, plugins/status-items.ts):
 *  a text, its tooltip, and a command a click runs. */
function PluginStatusItems() {
  const items = useSyncExternalStore(subscribeStatusItems, statusItemsSnapshot);
  return (
    <>
      {items.map((item) => {
        const label = (
          <span className="plugin-status-item" data-status={item.key}>
            {item.text}
          </span>
        );
        const shown = item.command ? (
          <button
            type="button"
            className="plugin-status-item plugin-status-button"
            data-status={item.key}
            onClick={() => runCommand(item.command!)}
          >
            {item.text}
          </button>
        ) : (
          label
        );
        return item.tooltip ? (
          <Tooltip key={item.key} text={item.tooltip}>
            {shown}
          </Tooltip>
        ) : (
          <Fragment key={item.key}>{shown}</Fragment>
        );
      })}
    </>
  );
}
