import { useRef, useState } from "react";
import { ai } from "../../platform/ipc";
import type { AgentTurn } from "../types";
import { passExchange } from "./memory-pass";
import { followUps } from "./follow-ups";

const NONE: string[] = [];

/**
 * What the writer will probably send next, after a reply: the first grey in
 * the empty message box (Tab takes it), all of them as buttons over it. A
 * failed request only means no suggestions.
 */
export function useNextMessage(provider: string, model: string, on: boolean) {
  const [suggestions, setSuggestions] = useState<string[]>(NONE);
  // Each ask's number: an answer counts only if no later ask, or `clear`,
  // came after it.
  const asked = useRef(0);

  /** Asks after `conversation`'s last exchange. */
  function suggestAfter(conversation: AgentTurn[]) {
    const ask = ++asked.current;
    setSuggestions(NONE);
    if (!on) return;
    void ai
      .suggestNextMessage({
        provider,
        model: model || null,
        exchange: passExchange(conversation),
      })
      .then((next) => {
        if (ask === asked.current) setSuggestions(followUps(next));
      })
      .catch(() => {});
  }

  function clear() {
    asked.current++;
    setSuggestions(NONE);
  }

  return { suggestions, suggestAfter, clear };
}
