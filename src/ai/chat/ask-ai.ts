import { useEffect, useState } from "react";
import type { AgentMode } from "../../prefs/settings-values";
import { requestCreate } from "./create-request";
import { askInComposer } from "./composer-asks";

/**
 * The AI panel asked for from outside the editor (a plugin's "Edit with AI"):
 * the document in front opens its panel in `mode` with `text` in the box.
 */

const ASK_AI_EVENT = "textus-ask-ai";

interface Asked {
  text: string;
  mode: AgentMode;
}

export function askAi(text: string, mode: AgentMode): void {
  // Create is made in Settings › Extensions, not beside a document; what
  // asks for it here is about a plugin.
  if (mode === "create") return requestCreate(text, "plugin");
  window.dispatchEvent(
    new CustomEvent<Asked>(ASK_AI_EVENT, { detail: { text, mode } }),
  );
}

/** For the document in front (`isActive`): opens its panel on an ask and
 *  puts the text in the box; the mode asked for, to set in the composer. */
export function useAskAi(
  isActive: boolean,
  setPanelOpen: (open: boolean) => void,
): AgentMode | null {
  const [mode, setMode] = useState<AgentMode | null>(null);
  useEffect(() => {
    if (!isActive) return;
    const onAsk = (e: Event) => {
      const { text, mode: asked } = (e as CustomEvent<Asked>).detail;
      setMode(asked);
      // Set once: asked again, it is set again.
      window.setTimeout(() => setMode(null), 400);
      setPanelOpen(true);
      askInComposer(text);
    };
    window.addEventListener(ASK_AI_EVENT, onAsk);
    return () => window.removeEventListener(ASK_AI_EVENT, onAsk);
  }, [isActive, setPanelOpen]);
  return mode;
}
