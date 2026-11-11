import { AI_PRESS_EVENT } from "../islands/ai-tabs";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { isIOSApp } from "../../platform/capabilities";
import { keyboardUp, whenKeyboardDown } from "../../mobile/keyboard";
import { usePresence } from "../../engine/motion/usePresence";
import { CLOSE_FIND_REPLACE_EVENT } from "../../utils/events";
import { useAgentPanelState } from "../../ai/chat/panel/agent-panel";
import { getUiState, setUiState } from "../../storage/ui-state";
import { useNarrowSidebar } from "./useNarrowSidebar";
import { useSidebarWidth } from "./sidebar-width";
import { RAIL_WIDTH } from "./ActivityRail";
import { chromeScale } from "../../engine/tokens/chrome-scale";
import { useSettings, type Settings } from "../../prefs/SettingsContext";
import { PANEL_FLOOR } from "../../engine/controls/side-panel-width";
import { storeSidebarTab, storedSidebarTab } from "./sidebar-tab";

/** A sidebar tab's id. */
export type PanelMode = string;

function subscribeWindowResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * Layout state of the sidebar and the docked Agent panel. `aiOn` is Textus
 * AI's switch: off, the AI panel closes and its toggles do nothing.
 */
/** Whether the window has the activity rail: on in Settings, and not on an
 *  iPad, whose sidebar is its own. */
function railShown(settings: Pick<Settings, "activityRail">): boolean {
  return settings.activityRail && !isIOSApp;
}

export function useSidePanels(aiOn: boolean) {
  // Remembered on the desktop; on iOS it is a drawer and starts closed.
  const [panelOpen, setPanelOpen] = useState(
    () => !isIOSApp && getUiState("sidebarOpen") === true,
  );
  const { settings, setSettings } = useSettings();
  // The rail hidden, the sidebar is put away with it, down to the window
  // bar's one button, which opens both together.
  const railOff = !isIOSApp && !settings.activityRail;
  const open = panelOpen && !railOff;
  const toggleSidebar = useCallback(() => {
    if (railOff) {
      setSettings({ activityRail: true });
      setPanelOpen(true);
    } else setPanelOpen((v) => !v);
  }, [railOff, setSettings]);
  // Asked to show a panel (a folder opened, search, a plugin's tab): the
  // rail comes back with it.
  const showPanel = useCallback(
    (show: boolean) => {
      if (show && railOff) setSettings({ activityRail: true });
      setPanelOpen(show);
    },
    [railOff, setSettings],
  );
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
  const rail = railShown(settings) ? Math.round(RAIL_WIDTH * chromeScale()) : 0;
  // An iPad's docked AI panel open, the sidebar leaves it its narrowest, so
  // a small window still keeps the document its room (the panel's open
  // state, one render late, is enough: it only bounds the sidebar). On the
  // desktop the AI is an island: the solver keeps its room.
  const [agentShown, setAgentShown] = useState(
    () => getUiState("agentPanelOpen") === true,
  );
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
  const agentPanel = useAgentPanelState(
    windowWidth,
    rail + (open ? sidebarWidth.width : 0),
  );
  useEffect(() => setAgentShown(agentPanel.open), [agentPanel.open]);
  // On a phone, the document gives up focus here and the AI page's input
  // doesn't take it, so the keyboard goes away in one movement. With the
  // keyboard up, the page comes once it has gone, or its bottom jumps.
  const pendingAgentOpen = useRef<(() => void) | null>(null);
  const setAgentOpen = agentPanel.setOpen;
  useEffect(() => {
    if (!aiOn) setAgentOpen(false);
  }, [aiOn, setAgentOpen]);
  const toggleAgentPanel = useCallback(() => {
    if (!aiOn) return;
    if (pendingAgentOpen.current) {
      // A second tap while it waits: it stays closed.
      pendingAgentOpen.current();
      pendingAgentOpen.current = null;
      return;
    }
    if (isIOSApp && !agentPanel.open) {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      if (keyboardUp()) {
        pendingAgentOpen.current = whenKeyboardDown(() => {
          pendingAgentOpen.current = null;
          agentPanel.setOpen(true);
        });
        return;
      }
    }
    // Shown on the desktop: what a press does is the AI tabs' to decide -
    // bring theirs to the front, or hide the AI (useAiTabs).
    if (!isIOSApp && agentPanel.open) {
      window.dispatchEvent(new Event(AI_PRESS_EVENT));
      return;
    }
    agentPanel.toggle();
  }, [aiOn, agentPanel]);
  // Both side panels play their way out before their contents go; the
  // editor makes or takes back its room at once.
  // Out on the islands' clock (sidebar-frame.css).
  const sidebarPresence = usePresence(open);
  const sidebarClosing = sidebarPresence.state === "closing";
  const agentPresence = usePresence(agentPanel.open);
  const agentClosing = agentPresence.state === "closing";
  // Remembered on the desktop like the open state; on iOS it starts on
  // Files.
  const [panelMode, setPanelMode] = useState<PanelMode>(() =>
    isIOSApp ? "tree" : storedSidebarTab(),
  );
  useEffect(() => {
    if (!isIOSApp) storeSidebarTab(panelMode);
  }, [panelMode]);

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
