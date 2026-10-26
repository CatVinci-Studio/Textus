import type { AgentTurn } from "../types";

/** Paired onto a tool call the stop interrupted: providers reject a history
 *  with an unanswered tool call. */
export const STOPPED_TOOL_RESULT =
  "Generation was stopped by the user before this tool call finished.";

/**
 * What a stopped exchange keeps: everything already streamed, plus the
 * cut-off prose as a final turn. Returns [] when only the user's message
 * streamed, so a send stopped at once vanishes rather than look ignored.
 */
export function keepCancelledTurns(
  streamed: AgentTurn[],
  partialText: string,
): AgentTurn[] {
  const text = partialText.trim() ? partialText : "";
  if (!text && streamed.every((t) => t.kind === "User")) return [];
  const closed: AgentTurn[] = [];
  for (let i = 0; i < streamed.length; i++) {
    const turn = streamed[i];
    closed.push(turn);
    if (turn.kind !== "ToolCall") continue;
    const answered = streamed.some(
      (t, j) => j > i && t.kind === "ToolResult" && t.call_id === turn.call_id,
    );
    if (!answered)
      closed.push({
        kind: "ToolResult",
        call_id: turn.call_id,
        output: STOPPED_TOOL_RESULT,
      });
  }
  if (text) closed.push({ kind: "Assistant", text });
  return closed;
}
