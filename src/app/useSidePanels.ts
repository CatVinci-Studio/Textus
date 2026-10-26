import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { isIOSApp } from "../platform/capabilities";
import { keyboardUp, whenKeyboardDown } from "../mobile/keyboard";
import { usePresence } from "../ui/usePresence";
import { CLOSE_FIND_REPLACE_EVENT } from "../utils/events";
import { useAgentPanelState } from "../ai/chat/panel/agent-panel";
import { getUiState, setUiState } from "../storage/ui-state";
import { setDockedPanelWidth } from "../utils/hooks/useDockedPanelWidth";
import { useSidebarWidth } from "./sidebar-width";
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
  const agentPanel = useAgentPanelState();
  // The docked panel stays beside the page whatever the sidebar does.
  const windowWidth = useSyncExternalStore(subscribeWindowResize, () =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  const sidebarWidth = useSidebarWidth(windowWidth);
  const [agentPanelEl, setAgentPanelEl] = useState<HTMLElement | null>(null);
  // On a phone, the document gives up focus here and the sheet's input
  // doesn't take it, so the keyboard goes away in one movement. With the
  // keyboard up, the sheet rises once it has gone, or its top jumps.
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
  // What the find bar and the tutorial card keep clear of on the right.
  const dockedWidth = agentPresence.mounted && !isIOSApp ? agentPanel.width : 0;
  useLayoutEffect(() => setDockedPanelWidth(dockedWidth), [dockedWidth]);
  // The phone's AI sheet leaves where it stood: as the keyboard goes, the
  // web view grows and the sheet's top would jump.
  useLayoutEffect(() => {
    const sheet = document.querySelector<HTMLElement>("aside.agent-panel");
    if (!isIOSApp || !sheet) return;
    if (!agentClosing) {
      for (const prop of ["top", "bottom", "height"])
        sheet.style.removeProperty(prop);
      return;
    }
    if (getComputedStyle(sheet).position !== "fixed") return;
    const box = sheet.getBoundingClientRect();
    sheet.style.top = `${box.top}px`;
    sheet.style.bottom = "auto";
    sheet.style.height = `${box.height}px`;
  }, [agentClosing]);
  // iPhone: whether the AI bottom sheet is pulled up to full height.
  const [sheetFull, setSheetFull] = useState(false);
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
    sheetFull,
    setSheetFull,
    panelMode,
    setPanelMode,
  };
}
