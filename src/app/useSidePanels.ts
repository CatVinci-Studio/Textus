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

export type PanelMode = "tree" | "outline" | "clipboard";

/** The narrowest text column the docked panel may leave beside the
 *  sidebar. */
const MIN_TEXT_COLUMN = 420;

function subscribeWindowResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * The layout state of the two side panels around the document: the sidebar
 * on the left (open, width, which tab it shows) and the docked Agent panel on the
 * right (open, width, whether it lies over the page, the phone's bottom
 * sheet). Pulled out of App.tsx, which renders both frames.
 *
 * `aiOn` is Textus AI's switch: turned off, the AI panel closes, and its
 * toggles (the shortcut, View › AI Panel) do nothing until it is back on.
 */
export function useSidePanels(aiOn: boolean) {
  // Remembered on the desktop, where people who use the sidebar expect it
  // back (#152, #79). On iOS it is a drawer over the page and starts closed.
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
  // The docked Agent panel on the right (ai/chat/panel/agent-panel.tsx). App owns
  // the frame; the active tab's editor renders its conversation into it.
  const agentPanel = useAgentPanelState();
  // With the sidebar and the docked panel both open, a small window left
  // the text column ~120px wide - a word a line. Below this much room for
  // the text the panel lies over the page instead, as it does on a narrow
  // window (agent-panel.css).
  const windowWidth = useSyncExternalStore(subscribeWindowResize, () =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  const sidebarWidth = useSidebarWidth(windowWidth);
  const agentOverlays =
    !isIOSApp &&
    panelOpen &&
    windowWidth - sidebarWidth.width - agentPanel.width < MIN_TEXT_COLUMN;
  const [agentPanelEl, setAgentPanelEl] = useState<HTMLElement | null>(null);
  // On a phone, opening the sheet puts the keyboard away in one movement:
  // the document gives up focus here and the sheet's input doesn't take it
  // (ChatComposer's focusOnOpen), where handing focus from one to the other
  // dropped the keyboard and raised it again.
  // And with the keyboard up, the sheet rises once it has gone: laid out
  // in a web view still growing back to full height under it, the sheet's
  // top jumped and its composer arrived late from below.
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
  // Both side panels play their way out before their contents go: the
  // sidebar slides back over the editor, the AI panel fades off its edge.
  // The editor makes its room (or takes it back) at once, gliding there
  // (App.tsx's FlipOnChange) rather than reflowing on every frame.
  const sidebarPresence = usePresence(panelOpen, { exitMs: 250 });
  const sidebarClosing = sidebarPresence.state === "closing";
  const agentPresence = usePresence(agentPanel.open, { exitMs: 250 });
  const agentClosing = agentPresence.state === "closing";
  // What the find bar and the tutorial card keep clear of on the right.
  const dockedWidth =
    agentPresence.mounted && !agentOverlays && !isIOSApp ? agentPanel.width : 0;
  useLayoutEffect(() => setDockedPanelWidth(dockedWidth), [dockedWidth]);
  // The phone's AI sheet leaves where it stood: closing with the keyboard
  // up, the web view grew back under it as the keyboard went and its
  // height (a share of the view) jumped the top up ~170pt in one frame.
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
  // Remembered on the desktop as the open state is (#196): people who live
  // in the Outline switched to it on every launch. On iOS, where the
  // drawer starts closed, it starts on Files too.
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
    agentOverlays,
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
