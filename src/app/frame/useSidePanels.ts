import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { usePhoneLayout } from "../../engine/controls/usePhoneLayout";
import { isPhoneLayout } from "../../platform/phone-layout";
import { usePresence } from "../../engine/motion/usePresence";
import { CLOSE_FIND_REPLACE_EVENT } from "../../utils/events";
import { useAgentDock } from "./useAgentDock";
import { usePushedSidebar } from "../../mobile/usePushedSidebar";
import { storeSidebarTab, storedSidebarTab } from "./sidebar-tab";
import { getUiState, setUiState } from "../../storage/ui-state";
import { useNarrowSidebar } from "./useNarrowSidebar";
import { useNarrowIslands } from "./useNarrowIslands";
import { useSidebarWidth } from "./sidebar-width";
import { RAIL_WIDTH } from "./ActivityRail";
import { chromeScale } from "../../engine/tokens/chrome-scale";
import { useSettings, type Settings } from "../../prefs/SettingsContext";

/** A sidebar tab's id. */
export type SidebarTabId = string;

function subscribeWindowResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** Whether the window shows the activity rail: on in Settings, or turned
 *  off but with the sidebar open. A phone's is always there, under the
 *  page with the sidebar, both shown as the page is pushed aside. */
export function railShown(
  settings: Pick<Settings, "activityRail">,
  open: boolean,
  phone: boolean,
): boolean {
  return settings.activityRail || phone || open;
}

/**
 * Layout state of the sidebar and the docked Agent panel. `aiOn` is Textus
 * AI's switch: off, the AI panel closes and its toggles do nothing. A new
 * tab in front pushes a phone's sidebar back.
 */
export function useSidePanels(aiOn: boolean, activeTabId: string) {
  const phone = usePhoneLayout();
  // Remembered, except on a phone, where it starts put away.
  const [open, setOpen] = useState(
    () => !isPhoneLayout() && getUiState("sidebarOpen") === true,
  );
  const { settings } = useSettings();
  // With the rail turned off, the window bar's button opens the sidebar
  // with the rail and folds both away; the rail stays off.
  const toggleSidebar = useCallback(() => setOpen((v) => !v), []);
  usePushedSidebar(phone, open, setOpen, activeTabId);
  useEffect(() => {
    if (!isPhoneLayout()) setUiState("sidebarOpen", open);
    // A phone's sidebar pushes the page aside: the find bar goes with it.
    else if (open)
      window.dispatchEvent(new CustomEvent(CLOSE_FIND_REPLACE_EVENT));
  }, [open]);
  // The docked Agent panel: App owns the frame.
  // Both panels narrow with a small window, by one rule; the AI panel also
  // leaves the document room beside an open sidebar.
  const windowWidth = useSyncExternalStore(subscribeWindowResize, () =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  // The activity rail is beside both panels, as each is beside the other:
  // the document keeps its room after all of them.
  const scale = chromeScale();
  const rail = railShown(settings, open, phone)
    ? Math.round(RAIL_WIDTH * scale)
    : 0;
  const sidebarWidth = useSidebarWidth(windowWidth, rail);
  // The panels give way after the sidebar, and come back before it.
  const panelsFolded = useNarrowIslands(
    phone ? Infinity : windowWidth - rail - (open ? sidebarWidth.width : 0),
    open,
  );
  // A phone's sidebar is pushed in by hand, over too little room: never
  // put away for it.
  useNarrowSidebar(
    open,
    setOpen,
    phone ? Infinity : windowWidth - rail,
    sidebarWidth.width,
    panelsFolded,
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
    setPanelOpen: setOpen,
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

/** The sidebar's tab, remembered like its open state. */
function useSidebarTab() {
  const [panelMode, setPanelMode] = useState<SidebarTabId>(storedSidebarTab);
  useEffect(() => {
    storeSidebarTab(panelMode);
  }, [panelMode]);

  return [panelMode, setPanelMode] as const;
}
