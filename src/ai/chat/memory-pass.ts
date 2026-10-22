import type { AgentTurn } from "../types";
import type { RememberedChange } from "../../platform/ipc";
import { parseUserMessage } from "./user-message";

/** How many of the user's messages the pass reads, newest last - the same
 *  number the backend shows it (ai/memory/pass.rs, RECENT_MESSAGES). */
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

/** The pass's changes as the chat keeps them: each a `remember` call and
 *  its result, which ChatMessages shows as a MemoryChip - and which the
 *  backend leaves out of what it sends the model
 *  (agent/history.rs, without_memory_turns). */
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
