import type { SkillOffer } from "../../platform/bindings/ai-memory";
import { OFFER_SKILL } from "./SkillOfferChip";
import type { AgentTurn } from "../types";
import type { RememberedChange } from "../../platform/ipc";
import { parseUserMessage } from "./user-message";

/** How many of the user's messages the pass reads, newest last. Keep in step
 *  with the backend's RECENT_MESSAGES. */
const RECENT_MESSAGES = 6;

/** What the memory pass reads of a conversation after an exchange: the
 *  user's messages as they typed them (no document, no selection), and the
 *  reply to the last. */
export function passExchange(history: AgentTurn[]): {
  messages: string[];
  reply: string;
} {
  const messages = history
    .flatMap((turn) =>
      turn.kind === "User" ? [parseUserMessage(turn.text).body] : [],
    )
    .filter((text) => text.length > 0)
    .slice(-RECENT_MESSAGES);
  const lastUser = history.map((t) => t.kind).lastIndexOf("User");
  const reply =
    history
      .slice(lastUser + 1)
      .filter(
        (t): t is Extract<AgentTurn, { kind: "Assistant" }> =>
          t.kind === "Assistant",
      )
      .map((t) => t.text)
      .pop() ?? "";
  return { messages, reply };
}

/** The pass's changes as the chat keeps them: each a `remember` call and its
 *  result, shown as a chip and left out of what is sent to the model. */
export function memoryTurns(
  changes: RememberedChange[],
  newId: () => string,
): AgentTurn[] {
  return changes.flatMap((change) => {
    const callId = `memory-${newId()}`;
    return [
      {
        kind: "ToolCall" as const,
        call_id: callId,
        name: "remember",
        arguments: JSON.stringify({ text: change.text }),
      },
      {
        kind: "ToolResult" as const,
        call_id: callId,
        output: JSON.stringify(change),
      },
    ];
  });
}

/** A skill offered after an exchange, as the call and result it stands in
 *  the conversation as. */
export function skillOfferTurns(
  offer: SkillOffer,
  newId: () => string,
): AgentTurn[] {
  const callId = `${OFFER_SKILL}-${newId()}`;
  return [
    {
      kind: "ToolCall",
      call_id: callId,
      name: OFFER_SKILL,
      arguments: "{}",
    },
    { kind: "ToolResult", call_id: callId, output: JSON.stringify(offer) },
  ];
}

/** `history` with `turns` put in at `at`: right after the exchange they
 *  belong to, though the user may have sent another message since. */
export function insertTurns(
  history: AgentTurn[],
  at: number,
  turns: AgentTurn[],
): AgentTurn[] {
  const where = Math.min(at, history.length);
  return [...history.slice(0, where), ...turns, ...history.slice(where)];
}

/** The remember results that come one after another (an exchange's
 *  changes), by the first's call id: each run is one list of chips. */
export function memoryRunsOf(
  turns: AgentTurn[],
  results: ReadonlyMap<string, unknown>,
): Map<string, string[]> {
  const runs = new Map<string, string[]>();
  let run: string[] | null = null;
  for (const turn of turns) {
    if (turn.kind === "ToolCall" && turn.name === "remember") continue;
    if (turn.kind === "ToolResult" && results.has(turn.call_id)) {
      if (run) run.push(turn.call_id);
      else runs.set(turn.call_id, (run = [turn.call_id]));
    } else run = null;
  }
  return runs;
}
