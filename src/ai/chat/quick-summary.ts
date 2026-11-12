import type { AgentTurn } from "../types";
import { lastExchange } from "./chat-body-types";
import { toolActivityText } from "./tool-activity";
import { userMessageBody } from "./user-message";

/** What Quick Ask's one line shows of its exchange. */
interface QuickSummary {
  /** The streamed prose while it arrives, else the last assistant reply (so
   *  a restored conversation shows it). */
  summaryText: string | null;
  /** The question it answers, echoed above it: once sent, the composer is
   *  empty. */
  promptText: string | null;
  /** Whether the exchange holds more than the line - tool steps, or a reply
   *  it clamps - and so earns "show all". */
  hasMore: boolean;
  /** What the agent is doing now (its latest tool call), in place of a bare
   *  "Thinking…" while a multi-step request works. */
  activity: string | null;
}

export function quickSummary(
  history: AgentTurn[],
  streaming: { turns: AgentTurn[]; text: string } | null,
  busy: boolean,
  labels: { toolActivity: Record<string, string> },
): QuickSummary {
  let activity: string | null = null;
  if (busy && streaming)
    for (let i = streaming.turns.length - 1; i >= 0; i--) {
      const turn = streaming.turns[i];
      if (turn.kind === "ToolCall") {
        activity = `${toolActivityText(turn.name, turn.arguments, labels)}…`;
        break;
      }
    }
  // The exchange in progress counts as the newest one: its user turn only
  // reaches `history` when the reply completes.
  const exchange = lastExchange(
    busy && streaming ? [...history, ...streaming.turns] : history,
  );
  let summaryText = streaming?.text || null;
  if (!summaryText && !busy)
    for (let i = exchange.turns.length - 1; i >= 0; i--) {
      const turn = exchange.turns[i];
      if (turn.kind === "Assistant" && turn.text.trim()) {
        summaryText = turn.text;
        break;
      }
    }
  return {
    summaryText,
    promptText: exchange.prompt
      ? userMessageBody(exchange.prompt).trim() || null
      : null,
    hasMore: exchange.turns.some(
      (turn) =>
        turn.kind === "ToolCall" ||
        (turn.kind === "Assistant" && turn.text.length > 160),
    ),
    activity,
  };
}
