import { Fragment, useSyncExternalStore } from "react";
import { useSettings } from "../prefs/SettingsContext";
import { WindowCaptionButtons } from "../ui/WindowCaptionButtons";
import type { MenuChecks } from "./menu/app-menu-model";
import { AppMenuButton } from "./WindowControls";
import { MenuBar } from "./menu/MenuBar";
import { appDrawsWindowFrame } from "../platform/window-chrome";
import { Tooltip } from "../ui/Tooltip";
import { TextusAiButton } from "../ai/TextusAiSwitch";
import { isIOSApp } from "../platform/capabilities";
import { LockIcon, SidebarToggleIcon } from "../ui/icons";
import { useFullscreenMark } from "./useFullscreenMark";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { PageSwitch } from "../mobile/PageSwitch";
import { usePageSwipe } from "../mobile/usePageSwipe";
import { runCommand } from "./commands";
import {
  statusItemsSnapshot,
  subscribeStatusItems,
} from "../plugins/contributions/status-items";

/**
 * The window's one top strip: a real layout row (an overlay title bar hides
 * the native drag area) and the drag region. Where the OS draws no frame,
 * it is also the caption and the app menu.
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
  onToggleReadOnly,
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
  /** The padlock beside a read-only document's title turns it off. */
  onToggleReadOnly: () => void;
}) {
  const { t, settings } = useSettings();
  useFullscreenMark();
  const menuBar = appDrawsWindowFrame && settings.menuBarShown;
  // A phone switches between the document and Textus AI as two pages: the
  // capsule takes the AI button's place, and the word count goes into the
  // menu to leave the row to the title.
  const phone = usePhoneLayout();
  const pages = phone && settings.textusAi && showAgentToggle;
  // An iPad keeps the docked panel, with the same edge swipes.
  usePageSwipe(
    isIOSApp && settings.textusAi && showAgentToggle,
    agentOpen,
    onToggleAgent,
  );
  return (
    <header className="window-bar" data-tauri-drag-region>
      {menuBar ? (
        <>
          <MenuBar checks={menuChecks} />
          {/* For a window too narrow for the titles. */}
          <span className="window-menu-fallback">
            <AppMenuButton checks={menuChecks} />
          </span>
        </>
      ) : (
        <AppMenuButton checks={pages ? { ...menuChecks, words } : menuChecks} />
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
      {/* The unsaved dot leads the title, as a native edited title does. */}
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
        {menuChecks.readOnly && (
          <Tooltip text={t.readOnlyLock}>
            <button
              type="button"
              className="window-bar-lock"
              aria-label={t.readOnlyLock}
              onClick={onToggleReadOnly}
            >
              <LockIcon />
            </button>
          </Tooltip>
        )}
      </span>
      <div className="window-bar-status">
        <PluginStatusItems />
        {largeDoc && (
          <span className="large-doc-badge" title={t.largeDocHint}>
            {t.largeDocBadge}
          </span>
        )}
        {!pages && (
          <span className="word-count">
            {words > 0 && `${words} ${words === 1 ? t.wordUnit : t.wordsUnit}`}
          </span>
        )}
        {/* Struck through while Textus AI is off; right-click pauses or
          turns it off. */}
        {pages ? (
          <PageSwitch
            ai={agentOpen}
            onChange={(ai) => {
              if (ai !== agentOpen) onToggleAgent();
            }}
          />
        ) : (
          <TextusAiButton
            className="window-bar-toggle"
            panelOpen={agentOpen}
            showPanel={showAgentToggle}
            shortcut={agentShortcut}
            onTogglePanel={onToggleAgent}
          />
        )}
      </div>
      <WindowCaptionButtons />
    </header>
  );
}

/** What plugins show here: a text, its tooltip, and a command a click
 *  runs. */
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
