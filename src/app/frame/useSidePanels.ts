import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { usePhoneLayout } from "../../engine/controls/usePhoneLayout";
import { isPhoneLayout } from "../../platform/phone-layout";
import { usePresence } from "../../engine/motion/usePresence";
import { CLOSE_FIND_REPLACE_EVENT, sendAppEvent } from "../../utils/events";
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
  // A phone has no rail: its library comes in as the drawer, its panel
  // tabs in the drawer's header (Sidebar.tsx).
  if (phone) return false;
  return settings.activityRail || open;
}

type SetOpen = Dispatch<SetStateAction<boolean>>;

/** Whether the sidebar is open: remembered, except on a phone, where it
 *  starts put away. With the rail turned off, the window bar's button opens
 *  the sidebar with the rail and folds both away; the rail stays off. */
function useSidebarOpen() {
  const [open, setOpen] = useState(
    () => !isPhoneLayout() && getUiState("sidebarOpen") === true,
  );
  const toggleSidebar = useCallback(() => setOpen((v) => !v), []);
  return { open, setOpen, toggleSidebar };
}

/** Remembered as it opens and closes, but not on a phone, whose sidebar
 *  pushes the page aside (the find bar goes with it); back from a phone's
 *  layout (a fold opened out), the wide layout's own, as remembered. */
function useSidebarRemembered(phone: boolean, open: boolean, setOpen: SetOpen) {
  const wasPhone = useRef(phone);
  useEffect(() => {
    if (wasPhone.current && !phone) setOpen(getUiState("sidebarOpen") === true);
    wasPhone.current = phone;
  }, [phone, setOpen]);
  useEffect(() => {
    if (!isPhoneLayout()) setUiState("sidebarOpen", open);
    else if (open) sendAppEvent(CLOSE_FIND_REPLACE_EVENT);
  }, [open]);
}

/** Both panels narrow with a small window, by one rule, beside the
 *  activity rail; the islands give way after the sidebar and come back
 *  before it, and a phone's sidebar, pushed in by hand, is never put away
 *  for want of room. */
function useSidebarFit(
  settings: Settings,
  phone: boolean,
  open: boolean,
  setOpen: SetOpen,
) {
  const windowWidth = useSyncExternalStore(subscribeWindowResize, () =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  const scale = chromeScale();
  const rail = railShown(settings, open, phone)
    ? Math.round(RAIL_WIDTH * scale)
    : 0;
  const sidebarWidth = useSidebarWidth(windowWidth, rail);
  const panelsFolded = useNarrowIslands(
    phone ? Infinity : windowWidth - rail,
    sidebarWidth.width,
    open,
  );
  useNarrowSidebar(
    open,
    setOpen,
    phone ? Infinity : windowWidth - rail,
    sidebarWidth.width,
    panelsFolded,
  );
  return { windowWidth, rail, sidebarWidth };
}

/** The sidebar's tabs, and its way out: it plays out before its contents
 *  go, on the islands' clock (sidebar-frame.css). A tab's key brings that
 *  tab to the front, or puts the sidebar away when it already is. */
function useSidebarTabs(open: boolean, setOpen: SetOpen) {
  const sidebarPresence = usePresence(open);
  const sidebarClosing = sidebarPresence.state === "closing";
  const [panelMode, setPanelMode] = useSidebarTab();
  const showSidebarTab = useCallback(
    (id: SidebarTabId) => {
      const shown = open && panelMode === id;
      setOpen(!shown);
      if (!shown) setPanelMode(id);
    },
    [open, panelMode, setPanelMode, setOpen],
  );
  return {
    sidebarPresence,
    sidebarClosing,
    panelMode,
    setPanelMode,
    showSidebarTab,
  };
}

/**
 * Layout state of the sidebar and the docked Agent panel. `aiOn` is Textus
 * AI's switch: off, the AI panel closes and its toggles do nothing. A new
 * tab in front pushes a phone's sidebar back.
 */
export function useSidePanels(aiOn: boolean, activeTabId: string) {
  const phone = usePhoneLayout();
  const { open, setOpen, toggleSidebar } = useSidebarOpen();
  const { settings } = useSettings();
  usePushedSidebar(phone, open, setOpen, activeTabId);
  useSidebarRemembered(phone, open, setOpen);
  const { windowWidth, rail, sidebarWidth } = useSidebarFit(
    settings,
    phone,
    open,
    setOpen,
  );
  const { agentPanel, toggleAgentPanel, agentPresence, agentClosing } =
    useAgentDock(aiOn, windowWidth, rail + (open ? sidebarWidth.width : 0));
  const {
    sidebarPresence,
    sidebarClosing,
    panelMode,
    setPanelMode,
    showSidebarTab,
  } = useSidebarTabs(open, setOpen);

  return {
    showSidebarTab,
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
