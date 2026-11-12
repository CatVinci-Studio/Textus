import { useCallback, useEffect, useRef } from "react";
import { useAgentPanelState } from "../../ai/chat/panel/agent-panel";
import { usePresence } from "../../engine/motion/usePresence";
import { keyboardUp, whenKeyboardDown } from "../../mobile/keyboard";
import { isIOSApp } from "../../platform/capabilities";
import { AI_PRESS_EVENT } from "../islands/ai-tabs";

/**
 * The docked AI panel: its state, its button and its way out. `aiOn` is
 * Textus AI's switch: off, the panel closes and its button does nothing.
 * `beside` is the room the rail and an open sidebar take.
 */
export function useAgentDock(
  aiOn: boolean,
  windowWidth: number,
  beside: number,
) {
  const agentPanel = useAgentPanelState(windowWidth, beside);
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
  const agentPresence = usePresence(agentPanel.open);
  const agentClosing = agentPresence.state === "closing";
  return { agentPanel, toggleAgentPanel, agentPresence, agentClosing };
}
