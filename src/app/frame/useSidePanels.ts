import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { isIOSApp } from "../../platform/capabilities";
import { usePresence } from "../../engine/motion/usePresence";
import { CLOSE_FIND_REPLACE_EVENT } from "../../utils/events";
import { useAgentPanelOpen } from "../../ai/chat/panel/agent-panel";
import { useAgentDock } from "./useAgentDock";
import { storeSidebarTab, storedSidebarTab } from "./sidebar-tab";
import { getUiState, setUiState } from "../../storage/ui-state";
import { useNarrowSidebar } from "./useNarrowSidebar";
import { useSidebarWidth } from "./sidebar-width";
import { RAIL_WIDTH } from "./ActivityRail";
import { chromeScale } from "../../engine/tokens/chrome-scale";
import { useSettings, type Settings } from "../../prefs/SettingsContext";
import { PANEL_FLOOR } from "../../engine/controls/side-panel-width";

/** A sidebar tab's id. */
export type SidebarTabId = string;

function subscribeWindowResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * Layout state of the sidebar and the docked Agent panel. `aiOn` is Textus
 * AI's switch: off, the AI panel closes and its toggles do nothing.
 */
/** Whether the window shows the activity rail: on in Settings, or turned
 *  off but with the sidebar open; never on an iPad, whose sidebar is its
 *  own. */
function railShown(
  settings: Pick<Settings, "activityRail">,
  open: boolean,
): boolean {
  return (settings.activityRail || open) && !isIOSApp;
}

export function useSidePanels(aiOn: boolean) {
  // Remembered on the desktop; on iOS it is a drawer and starts closed.
  const [panelOpen, setPanelOpen] = useState(
    () => !isIOSApp && getUiState("sidebarOpen") === true,
  );
  const { settings } = useSettings();
  // With the rail turned off, the window bar's button opens the sidebar
  // with the rail and folds both away; the rail stays off.
  const open = panelOpen;
  const toggleSidebar = useCallback(() => setPanelOpen((v) => !v), []);
  const showPanel = setPanelOpen;
  useEffect(() => {
    if (!isIOSApp) setUiState("sidebarOpen", panelOpen);
  }, [panelOpen]);
  // On iOS the sidebar is a drawer over the page, and the find bar sits at
  // the top of the page: they would overlap, so opening one closes the bar.
  useEffect(() => {
    if (isIOSApp && panelOpen)
      window.dispatchEvent(new CustomEvent(CLOSE_FIND_REPLACE_EVENT));
  }, [panelOpen]);
  // The docked Agent panel: App owns the frame.
  // Both panels narrow with a small window, by one rule; the AI panel also
  // leaves the document room beside an open sidebar.
  const windowWidth = useSyncExternalStore(subscribeWindowResize, () =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  // The activity rail is beside both panels, as each is beside the other:
  // the document keeps its room after all of them.
  const rail = railShown(settings, panelOpen)
    ? Math.round(RAIL_WIDTH * chromeScale())
    : 0;
  // An iPad's docked AI panel open, the sidebar leaves it its narrowest, so
  // a small window still keeps the document its room. On the desktop the AI
  // is an island: the solver keeps its room.
  const agentShown = useAgentPanelOpen();
  const scale = chromeScale();
  const sidebarWidth = useSidebarWidth(
    windowWidth,
    rail + (isIOSApp && agentShown ? PANEL_FLOOR * scale : 0),
  );
  // An iPhone's or iPad's sidebar is a drawer over the page: never put away.
  useNarrowSidebar(
    panelOpen,
    setPanelOpen,
    isIOSApp ? Infinity : windowWidth - rail,
    sidebarWidth.width,
  );
  const { agentPanel, toggleAgentPanel, agentPresence, agentClosing } =
    useAgentDock(aiOn, windowWidth, rail + (open ? sidebarWidth.width : 0));
  // Both side panels play their way out before their contents go; the
  // editor makes or takes back its room at once.
  // Out on the islands' clock (sidebar-frame.css).
  const sidebarPresence = usePresence(open);
  const sidebarClosing = sidebarPresence.state === "closing";
  const [panelMode, setPanelMode] = useSidebarTab();

  return {
    panelOpen: open,
    setPanelOpen: showPanel,
    toggleSidebar,
    sidebarWidth,
    agentPanel,
    toggleAgentPanel,
    sidebarPresence,
    sidebarClosing,
    agentPresence,
    agentClosing,
    panelMode,
    setPanelMode,
  };
}

/** The sidebar's tab: remembered on the desktop like its open state; on
 *  iOS it starts on Files. */
function useSidebarTab() {
  const [panelMode, setPanelMode] = useState<SidebarTabId>(() =>
    isIOSApp ? "tree" : storedSidebarTab(),
  );
  useEffect(() => {
    if (!isIOSApp) storeSidebarTab(panelMode);
  }, [panelMode]);

  return [panelMode, setPanelMode] as const;
}
