import { isIOSApp } from "../../../platform/capabilities";
import {
  setPanelWidth,
  usePanelWidth,
} from "../../../engine/frame/panel-width";
import { chromeScale } from "../../../engine/tokens/chrome-scale";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getUiState, setUiState } from "../../../storage/ui-state";
import {
  clampSidePanel,
  sidePanelMax,
  sidePanelMin,
} from "../../../engine/controls/side-panel-width";
import type { AgentPanelTab } from "./AgentPanelView";
import "./agent-panel.css";
import "../inline-chat.css";

/**
 * The docked Agent panel's frame: open, width and tab. The window's
 * conversations draw themselves in it; the document in front reads whether
 * it shows.
 */
export interface AgentPanelFrame {
  setOpen: (open: boolean) => void;
  /** The AI shows (still, while it plays its exit). */
  shown: boolean;
  /** Which of the panel's tabs shows. */
  tab: AgentPanelTab;
  setTab: (tab: AgentPanelTab) => void;
}

const AgentPanelContext = createContext<AgentPanelFrame>({
  setOpen: () => {},
  shown: false,
  tab: "chat",
  setTab: () => {},
});

export function useAgentPanel(): AgentPanelFrame {
  return useContext(AgentPanelContext);
}

const AGENT_PANEL_MIN_WIDTH = 330;
const AGENT_PANEL_MAX_WIDTH = 792;

const LIMITS = { min: AGENT_PANEL_MIN_WIDTH, max: AGENT_PANEL_MAX_WIDTH };

// Whether the panel is open: one value, read by the frame and the panel.
let openNow: boolean | null = null;
const openListeners = new Set<() => void>();
const openSnapshot = () => (openNow ??= getUiState("agentPanelOpen") === true);
const onOpenChange = (listener: () => void) => {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
};

/** Whether the docked panel is open. */
function useAgentPanelOpen(): boolean {
  return useSyncExternalStore(onOpenChange, openSnapshot);
}

/** The panel's open state and width, remembered across launches. Shown
 *  narrower in a window too small for it, as the sidebar is
 *  (side-panel-width): `beside` is the open sidebar's width. */
export function useAgentPanelState(windowWidth: number, beside: number) {
  const open = useAgentPanelOpen();
  // Only an iPad's or iPhone's docked panel is drawn at it; on the desktop
  // the AI is an island, which the islands' area sizes itself.
  const chosen = usePanelWidth(isIOSApp);
  // Kept in the interface's size units, shown at its size now.
  const scale = chromeScale();
  const width = clampSidePanel(
    chosen * scale,
    windowWidth,
    LIMITS,
    beside,
    scale,
  );
  const [tab, setTab] = useState<AgentPanelTab>("chat");
  const setOpen = useCallback(
    (next: boolean) => {
      setUiState("agentPanelOpen", next);
      if (openNow !== next) {
        openNow = next;
        for (const listener of openListeners) listener();
      }
      // Whatever opens the panel - the shortcut, Ask AI, a restored chat,
      // "ask about this note" - wants the conversation.
      if (next) setTab("chat");
    },
    [setTab],
  );
  // Remembered once a drag lets go, not on every frame of it.
  const setWidth = useCallback(
    (next: number, persist = true) => {
      const step = chromeScale();
      const base = Math.round(
        clampSidePanel(next, windowWidth, LIMITS, beside, step) / step,
      );
      setPanelWidth(base, persist);
    },
    [windowWidth, beside],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  // How far it may be dragged here, for its handle's keys and readers.
  const min = Math.round(sidePanelMin(windowWidth, LIMITS, beside, scale));
  const max = Math.round(sidePanelMax(windowWidth, LIMITS, beside, scale));
  return { open, setOpen, toggle, width, min, max, setWidth, tab, setTab };
}

export function AgentPanelProvider({
  open,
  setOpen,
  tab,
  setTab,
  children,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  tab: AgentPanelTab;
  setTab: (tab: AgentPanelTab) => void;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ setOpen, shown: open, tab, setTab }),
    [open, setOpen, tab, setTab],
  );
  return (
    <AgentPanelContext.Provider value={value}>
      {children}
    </AgentPanelContext.Provider>
  );
}
