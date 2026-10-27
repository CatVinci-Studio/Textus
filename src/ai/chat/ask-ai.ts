import { useEffect, useState } from "react";
import type { AgentMode } from "../../settings/settings-types";

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
      // Once the panel - and the composer in the mode asked for - is up.
      window.setTimeout(() => fillComposer(text), 80);
    };
    window.addEventListener(ASK_AI_EVENT, onAsk);
    return () => window.removeEventListener(ASK_AI_EVENT, onAsk);
  }, [isActive, setPanelOpen]);
  return mode;
}

/** `text` into the AI panel's composer, the caret after it. */
function fillComposer(text: string) {
  const box = document.querySelector<HTMLTextAreaElement>(
    ".agent-panel-view textarea",
  );
  if (!box) return;
  // React's own setter, so the composer's state hears the change.
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  box.setSelectionRange(text.length, text.length);
}
