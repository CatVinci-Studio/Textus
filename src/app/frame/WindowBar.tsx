import { Fragment, Suspense, useSyncExternalStore } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import { WindowCaptionButtons } from "../../engine/controls/WindowCaptionButtons";
import type { MenuChecks } from "../../registry/menu/app-menu-model";
import { AppMenuButton } from "./WindowControls";
import { MenuBar } from "../menu/MenuBar";
import { Tooltip } from "../../engine/controls/Tooltip";
import { TextusAiButton } from "../../ai/TextusAiSwitch";
import { AgentButtons } from "../../ai/agents/AgentButtons";
import { canUseWindows, isIOSApp } from "../../platform/capabilities";
import { LockIcon, SidebarToggleIcon } from "../../engine/controls/icons";
import { useBarLayout } from "../../engine/layout/useBarLayout";
import { useTitleRoom } from "./useTitleRoom";
import { usePhoneLayout } from "../../engine/controls/usePhoneLayout";
import { PageSwitch } from "../../mobile/PageSwitch";
import { usePageSwipe } from "../../mobile/usePageSwipe";
import { lazyModule } from "../../lazy/lazy-module";
import { lazyComponent } from "../../lazy/lazy-component";
import {
  statusItemsSnapshot,
  subscribeStatusItems,
} from "../../plugins/contributions/status-items";

// What plugins show here comes with the first of it: plugins run once the
// window is up, so it stays out of what loads before the first frame.
const PluginStatusItems = lazyComponent(
  lazyModule("plugin-status", () => import("../PluginStatusItems")),
  (m) => m.PluginStatusItems,
);

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
  const bar = useBarLayout({
    menuBarShown: settings.menuBarShown,
    rail: settings.activityRail,
    zen: !!menuChecks.zen,
  });
  const hasStatus = useSyncExternalStore(
    subscribeStatusItems,
    () => statusItemsSnapshot().length > 0,
  );
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
  const titleRef = useTitleRoom(
    !bar.lead.includes("menu-bar") && canUseWindows,
  );
  return (
    <>
      {/* The frosted bar's glass, layered under it: see window-bar.css. */}
      <div className="window-bar-glass" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <header className="window-bar" data-tauri-drag-region>
        {bar.lead.map((item) => {
          switch (item) {
            case "lights":
              // The traffic lights' room, for the tabs to clear.
              return (
                <span
                  key={item}
                  className="window-bar-lead window-bar-lights"
                  aria-hidden
                />
              );
            case "menu-bar":
              return (
                <Fragment key={item}>
                  <MenuBar checks={menuChecks} />
                  {/* For a window too narrow for the titles. */}
                  <span className="window-menu-fallback">
                    <AppMenuButton checks={menuChecks} />
                  </span>
                </Fragment>
              );
            case "menu":
              return (
                <AppMenuButton
                  key={item}
                  checks={pages ? { ...menuChecks, words } : menuChecks}
                />
              );
            case "sidebar-toggle":
              return (
                <Tooltip
                  key={item}
                  text={`${t.menuToggleSidebar} (${sidebarShortcut})`}
                >
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
              );
          }
        })}
        {/* The unsaved dot leads the title, as a native edited title does. */}
        <span className="window-bar-title" ref={titleRef}>
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
          {hasStatus && (
            <Suspense fallback={null}>
              <PluginStatusItems />
            </Suspense>
          )}
          {/* On the desktop each document says these at its own corner
              (DocumentCorner); a phone or an iPad has one, up here. */}
          {!canUseWindows && largeDoc && (
            <span className="large-doc-badge" title={t.largeDocHint}>
              {t.largeDocBadge}
            </span>
          )}
          {!canUseWindows && !pages && (
            <span className="word-count">
              {words > 0 &&
                `${words} ${words === 1 ? t.wordUnit : t.wordsUnit}`}
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
            <>
              <AgentButtons aiOpen={agentOpen} onToggleAi={onToggleAgent} />
              <TextusAiButton
                className="window-bar-toggle"
                panelOpen={agentOpen}
                showPanel={showAgentToggle}
                shortcut={agentShortcut}
                onTogglePanel={onToggleAgent}
              />
            </>
          )}
        </div>
        <WindowCaptionButtons />
      </header>
    </>
  );
}
