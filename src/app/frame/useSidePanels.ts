import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { isIOSApp } from "../../platform/capabilities";
import { keyboardUp, whenKeyboardDown } from "../../mobile/keyboard";
import { usePresence } from "../../ui/usePresence";
import { CLOSE_FIND_REPLACE_EVENT } from "../../utils/events";
import { useAgentPanelState } from "../../ai/chat/panel/agent-panel";
import { getUiState, setUiState } from "../../storage/ui-state";
import { useSidebarWidth } from "./sidebar-width";
import { RAIL_WIDTH } from "./ActivityRail";
import { chromeScaleAt } from "../../engine/tokens/chrome-scale";
import { useSettings, type Settings } from "../../prefs/SettingsContext";
import { PANEL_FLOOR } from "../../ui/side-panel-width";
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
export function railShown(settings: Pick<Settings, "activityRail">): boolean {
  return settings.activityRail && !isIOSApp;
}

export function useSidePanels(aiOn: boolean) {
  // Remembered on the desktop; on iOS it is a drawer and starts closed.
  const [panelOpen, setPanelOpen] = useState(
    () => !isIOSApp && getUiState("sidebarOpen") === true,
  );
  const toggleSidebar = useCallback(() => setPanelOpen((v) => !v), []);
  useEffect(() => {
    if (!isIOSApp) setUiState("sidebarOpen", panelOpen);
  }, [panelOpen]);
  // On iOS the sidebar is a drawer over the page, and the find bar sits at
  // the top of the page: they would overlap, so opening one closes the bar.
  useEffect(() => {
    if (isIOSApp && panelOpen)
      window.dispatchEvent(new CustomEvent(CLOSE_FIND_REPLACE_EVENT));
  }, [panelOpen]);
  // The docked Agent panel: App owns the frame, the active tab's editor
  // renders its conversation into it.
  // Both panels narrow with a small window, by one rule; the AI panel also
  // leaves the document room beside an open sidebar.
  const windowWidth = useSyncExternalStore(subscribeWindowResize, () =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  // The activity rail is beside both panels, as each is beside the other:
  // the document keeps its room after all of them.
  const { settings } = useSettings();
  const rail = railShown(settings)
    ? Math.round(RAIL_WIDTH * chromeScaleAt(windowWidth))
    : 0;
  // With the AI panel open the sidebar leaves it its narrowest, so a small
  // window still keeps the document its room (the panel's open state, one
  // render late, is enough: it only bounds the sidebar).
  const [agentShown, setAgentShown] = useState(
    () => getUiState("agentPanelOpen") === true,
  );
  const scale = chromeScaleAt(windowWidth);
  const sidebarWidth = useSidebarWidth(
    windowWidth,
    rail + (agentShown ? PANEL_FLOOR * scale : 0),
  );
  const agentPanel = useAgentPanelState(
    windowWidth,
    rail + (panelOpen ? sidebarWidth.width : 0),
  );
  useEffect(() => setAgentShown(agentPanel.open), [agentPanel.open]);
  const [agentPanelEl, setAgentPanelEl] = useState<HTMLElement | null>(null);
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
    agentPanel.toggle();
  }, [aiOn, agentPanel]);
  // Both side panels play their way out before their contents go; the
  // editor makes or takes back its room at once.
  const sidebarPresence = usePresence(panelOpen, { exitMs: 250 });
  const sidebarClosing = sidebarPresence.state === "closing";
  const agentPresence = usePresence(agentPanel.open, { exitMs: 250 });
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
    panelOpen,
    setPanelOpen,
    toggleSidebar,
    sidebarWidth,
    agentPanel,
    agentPanelEl,
    setAgentPanelEl,
    toggleAgentPanel,
    sidebarPresence,
    sidebarClosing,
    agentPresence,
    agentClosing,
    panelMode,
    setPanelMode,
  };
}
