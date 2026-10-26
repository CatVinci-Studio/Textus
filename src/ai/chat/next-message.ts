import { useRef, useState } from "react";
import { ai } from "../../platform/ipc";
import type { AgentTurn } from "../types";
import { passExchange } from "./memory-pass";

/**
 * What the writer will probably send next, after a reply: grey in the empty
 * message box, Tab to take it. A failed request only means no suggestion.
 */
export function useNextMessage(provider: string, model: string, on: boolean) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  // Each ask's number: an answer counts only if no later ask, or `clear`,
  // came after it.
  const asked = useRef(0);

  /** Asks after `conversation`'s last exchange. */
  function suggestAfter(conversation: AgentTurn[]) {
    const ask = ++asked.current;
    setSuggestion(null);
    if (!on) return;
    void ai
      .suggestNextMessage({
        provider,
        model: model || null,
        exchange: passExchange(conversation),
      })
      .then((next) => {
        if (ask === asked.current) setSuggestion(next);
      })
      .catch(() => {});
  }

  function clear() {
    asked.current++;
    setSuggestion(null);
  }

  return { suggestion, suggestAfter, clear };
}
