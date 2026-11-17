import { useEffect, useRef, useState } from "react";
import type { AgentMode } from "../../prefs/settings-values";
import { requestCreate } from "./create-request";
import { askInComposer } from "./composer-asks";
import { createSubscribers } from "../../utils/store";

/**
 * The AI panel asked for from outside the editor (a plugin's "Edit with AI"):
 * the document in front opens its panel in `mode` with `text` in the box.
 */

interface Asked {
  text: string;
  mode: AgentMode;
}

const asks = createSubscribers<[asked: Asked]>();

export function askAi(text: string, mode: AgentMode): void {
  // Create is made in Settings › Extensions, not beside a document; what
  // asks for it here is about a plugin.
  if (mode === "create") return requestCreate(text, "plugin");
  asks.publish({ text, mode });
}

/** For the document in front (`isActive`): opens its panel on an ask and
 *  puts the text in the box; the mode asked for, to set in the composer. */
export function useAskAi(
  isActive: boolean,
  setPanelOpen: (open: boolean) => void,
): AgentMode | null {
  const [mode, setMode] = useState<AgentMode | null>(null);
  const latest = useRef<object | null>(null);
  useEffect(() => {
    if (!isActive) return;
    return asks.subscribe(({ text, mode: asked }) => {
      const ask = {};
      latest.current = ask;
      setMode(asked);
      setPanelOpen(true);
      // Set once, for the composer that takes the ask - however long its
      // panel takes to open: asked again, it is set again, and an earlier
      // ask settling doesn't clear the later one's.
      void askInComposer(text).then(() =>
        window.setTimeout(() => {
          if (latest.current === ask) setMode(null);
        }),
      );
    });
  }, [isActive, setPanelOpen]);
  return mode;
}
