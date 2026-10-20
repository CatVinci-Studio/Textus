import type { AgentTurn } from "../types";
import { STOPPED_TOOL_RESULT } from "../chat/cancelled-turns";
import { isProposalTool } from "../chat/proposal";
import type { PendingStatus } from "./usePendingEdits";

/**
 * What each status means for the model, appended to the proposal's tool
 * result at request time. The wording leans on one fact the model can't
 * infer on its own: the document it is shown each turn contains ONLY
 * accepted edits, so an undecided or rejected proposal is absent from it -
 * without saying so, the model assumes its last proposal landed and either
 * re-proposes it or anchors follow-ups to text that isn't in the document.
 */
/** What tools.rs's propose_edit result starts with when the proposal
 *  stands. Anything else (a missing anchor, a cut-off `text`) refused it:
 *  the model was told so and resends, so the call must never become a
 *  preview - the editor would otherwise show an edit the backend rejected
 *  ("due" for a whole sentence, round 4 of docs/design/ai-eval.md). */
const PROPOSED_PREFIX = "Edit proposed";
/** The same for generate_image (ai/images.rs): a picture was made. */
const IMAGE_PROPOSED_PREFIX = "Image proposed";

/** A propose_edit (or generate_image) result that refused the proposal. Results replaced by a
 *  stop (cancelled-turns.ts) aren't refusals: what streamed is kept. */
export function isRefusal(output: string): boolean {
  return (
    !output.startsWith(PROPOSED_PREFIX) &&
    !output.startsWith(IMAGE_PROPOSED_PREFIX) &&
    output !== STOPPED_TOOL_RESULT
  );
}

/** Call ids of the propose_edit calls in `turns` whose result refused them. */
export function refusedProposalIds(turns: AgentTurn[]): Set<string> {
  const proposals = new Set(
    turns.flatMap((t) =>
      t.kind === "ToolCall" && isProposalTool(t.name) ? [t.call_id] : [],
    ),
  );
  const refused = new Set<string>();
  for (const t of turns)
    if (
      t.kind === "ToolResult" &&
      proposals.has(t.call_id) &&
      isRefusal(t.output)
    )
      refused.add(t.call_id);
  return refused;
}

const STATUS_NOTES: Record<PendingStatus, string> = {
  pending:
    "Status: the user has NOT yet accepted or rejected this proposed edit. It is still shown to them as a preview and is NOT part of the document text in this request - do not assume it was applied, and do not anchor new edits to its text.",
  // Still revealing/arguments still arriving - same consequence as pending.
  streaming:
    "Status: the user has NOT yet accepted or rejected this proposed edit. It is still shown to them as a preview and is NOT part of the document text in this request - do not assume it was applied, and do not anchor new edits to its text.",
  accepted:
    "Status: the user accepted this proposed edit - the document text in this request includes it.",
  rejected:
    "Status: the user rejected this proposed edit - it was not applied. Don't propose it again unless asked.",
  invalid:
    "Status: this proposed edit could not be applied (the text it targeted changed) and was discarded - it is not part of the document.",
  expired:
    "Status: this proposed edit is from an earlier session and was never applied - it is not part of the document.",
};

/**
 * The conversation history as sent to the backend, with each propose_edit
 * tool result annotated with the proposal's CURRENT status. Applied fresh on
 * every send (never persisted - the stored history stays clean, and a status
 * can still change between sends). `statuses` is usePendingEdits'
 * `allStatuses`: only propose_edit call ids ever enter it, so presence in
 * the map is what identifies a proposal's result - a tool result absent from
 * it (other tools, or a proposal that failed validation and never became a
 * preview) passes through untouched.
 *
 * The backend counterpart: tools.rs's propose_edit result tells the model
 * "the user now sees it with an Apply button"; this is the follow-up that
 * result promises nothing about, and agent.rs's AGENT_TOOL_INSTRUCTIONS
 * tells the model to expect it.
 */
export function annotateProposalStatuses(
  history: AgentTurn[],
  statuses: Record<string, PendingStatus>,
): AgentTurn[] {
  if (Object.keys(statuses).length === 0) return history;
  return history.map((turn) => {
    if (turn.kind !== "ToolResult") return turn;
    const status = statuses[turn.call_id];
    if (!status || isRefusal(turn.output)) return turn;
    return { ...turn, output: `${turn.output}\n\n[${STATUS_NOTES[status]}]` };
  });
}
