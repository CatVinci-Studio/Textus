import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getUiState, setUiState } from "../../../storage/ui-state";
import type { AgentPanelTab } from "./AgentPanelView";
import "./agent-panel.css";
import "../inline-chat.css";

/**
 * The docked Agent panel's frame: open, width, tab and the element to render
 * into. Each tab's editor portals its own chat into it while active, so the
 * conversation switches with the document.
 */
export interface AgentPanelFrame {
  setOpen: (open: boolean) => void;
  /** The element the active editor portals into; null while closed. */
  container: HTMLElement | null;
  /** Which of the panel's tabs shows. The frame's, not each editor's, so
   *  bringing another document to the front doesn't reset it. */
  tab: AgentPanelTab;
  setTab: (tab: AgentPanelTab) => void;
}

const AgentPanelContext = createContext<AgentPanelFrame>({
  setOpen: () => {},
  container: null,
  tab: "chat",
  setTab: () => {},
});

export function useAgentPanel(): AgentPanelFrame {
  return useContext(AgentPanelContext);
}

export const AGENT_PANEL_MIN_WIDTH = 300;
export const AGENT_PANEL_MAX_WIDTH = 720;
export const AGENT_PANEL_DEFAULT_WIDTH = 380;

function clampWidth(width: number): number {
  return Math.min(
    AGENT_PANEL_MAX_WIDTH,
    Math.max(AGENT_PANEL_MIN_WIDTH, width),
  );
}

/** The panel's open state and width, remembered across launches. */
export function useAgentPanelState() {
  const [open, setOpenState] = useState(
    () => getUiState("agentPanelOpen") === true,
  );
  const [width, setWidthState] = useState(() => {
    const stored = getUiState("agentPanelWidth");
    return typeof stored === "number" && Number.isFinite(stored) && stored > 0
      ? clampWidth(stored)
      : AGENT_PANEL_DEFAULT_WIDTH;
  });
  const [tab, setTab] = useState<AgentPanelTab>("chat");
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    setUiState("agentPanelOpen", next);
    // Whatever opens the panel - the shortcut, Ask AI, a restored chat,
    // "ask about this note" - wants the conversation.
    if (next) setTab("chat");
  }, []);
  // Remembered once a drag lets go, not on every frame of it.
  const setWidth = useCallback((next: number, persist = true) => {
    const clamped = clampWidth(next);
    setWidthState(clamped);
    if (persist) setUiState("agentPanelWidth", Math.round(clamped));
  }, []);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  return { open, setOpen, toggle, width, setWidth, tab, setTab };
}

export function AgentPanelProvider({
  open,
  setOpen,
  container,
  tab,
  setTab,
  children,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  container: HTMLElement | null;
  tab: AgentPanelTab;
  setTab: (tab: AgentPanelTab) => void;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ setOpen, container: open ? container : null, tab, setTab }),
    [open, setOpen, container, tab, setTab],
  );
  return (
    <AgentPanelContext.Provider value={value}>
      {children}
    </AgentPanelContext.Provider>
  );
}
