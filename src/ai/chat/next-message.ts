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
export class NextMessage {
  // Each ask's number: an answer counts only if no later ask, or `clear`,
  // came after it.
  private asked = 0;

  constructor(private readonly show: (suggestions: string[]) => void) {}

  /** Asks after `conversation`'s last exchange, where `on`. */
  suggestAfter(
    conversation: AgentTurn[],
    provider: string,
    model: string | null,
    on: boolean,
  ) {
    const ask = ++this.asked;
    this.show(NONE);
    if (!on) return;
    void ai
      .suggestNextMessage({
        provider,
        model,
        exchange: passExchange(conversation),
      })
      .then((next) => {
        if (ask === this.asked) this.show(followUps(next));
      })
      .catch(() => {});
  }

  clear() {
    this.asked++;
    this.show(NONE);
  }
}
