import { Fragment, Suspense, useRef, useSyncExternalStore } from "react";
import { useFitSteps } from "../../engine/controls/fit-steps";
import { useSettings } from "../../prefs/SettingsContext";
import { WindowCaptionButtons } from "../../engine/controls/WindowCaptionButtons";
import type { MenuChecks } from "../../registry/menu/app-menu-model";
import { AppMenuButton } from "./WindowControls";
import { MenuBar } from "../menu/MenuBar";
import { Tooltip } from "../../engine/controls/Tooltip";
import { TextusAiButton } from "../../ai/TextusAiSwitch";
import { AgentButtons } from "../../ai/agents/AgentButtons";
import { canUseWindows } from "../../platform/capabilities";
import { LockIcon, SidebarToggleIcon } from "../../engine/controls/icons";
import { useBarLayout } from "../../engine/layout/useBarLayout";
import { useTitleRoom } from "./useTitleRoom";
import { usePhoneLayout } from "../../engine/controls/usePhoneLayout";
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

const MENU_FOLDS = ["menu"] as const;

/**
 * The window's one top strip: a real layout row (an overlay title bar hides
 * the native drag area) and the drag region. Where the OS draws no frame,
 * it is also the caption and the app menu.
 */
export function WindowBar({
  menuChecks,
  title,
  dirty,
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
    titleRowShown: canUseWindows && settings.titleRowShown,
    rail: settings.activityRail || sidebarOpen,
    railOff: !settings.activityRail,
    zen: !!menuChecks.zen,
  });
  const hasStatus = useSyncExternalStore(
    subscribeStatusItems,
    () => statusItemsSnapshot().length > 0,
  );
  // A phone's row is its tabs': no title over them.
  const phone = usePhoneLayout();
  // Too narrow for the menu bar's titles: the ☰ instead (window-controls.css).
  const header = useRef<HTMLElement>(null);
  useFitSteps(header, MENU_FOLDS);
  return (
    <>
      <header ref={header} className="window-bar" data-tauri-drag-region>
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
              return <AppMenuButton key={item} checks={menuChecks} />;
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
        <WindowTitle
          placed={bar.rows === 1 && !bar.lead.includes("menu-bar") && !phone}
          title={title}
          dirty={dirty}
          readOnly={!!menuChecks.readOnly}
          onToggleReadOnly={onToggleReadOnly}
        />
        <div className="window-bar-status">
          {hasStatus && (
            <Suspense fallback={null}>
              <PluginStatusItems />
            </Suspense>
          )}
          {/* Struck through while Textus AI is off; right-click pauses or
          turns it off. */}
          <AgentButtons aiOpen={agentOpen} onToggleAi={onToggleAgent} />
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
    </>
  );
}

/** The document's name over its island, followed as the islands move
 *  (useTitleRoom): drawn on its own, so a divider dragged redraws only it. */
function WindowTitle({
  placed,
  title,
  dirty,
  readOnly,
  onToggleReadOnly,
}: {
  placed: boolean;
  title: string;
  dirty: boolean;
  readOnly: boolean;
  onToggleReadOnly: () => void;
}) {
  const { t } = useSettings();
  const titleRef = useTitleRoom(placed);
  // The unsaved dot leads the title, as a native edited title does.
  return (
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
      <span className="tx-truncate window-bar-title-text">{title}</span>
      {readOnly && (
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
  );
}
