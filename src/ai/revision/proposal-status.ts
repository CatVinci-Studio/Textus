import type { AgentTurn } from "../types";
import { STOPPED_TOOL_RESULT } from "../chat/cancelled-turns";
import { isProposalTool } from "../chat/proposal";
import type { PendingStatus } from "./usePendingEdits";

/** What propose_edit's result starts with when the proposal stands. Anything
 *  else refused it, and the call must never become a preview. */
const PROPOSED_PREFIX = "Edit proposed";
/** The same for generate_image: a picture was made. */
const IMAGE_PROPOSED_PREFIX = "Image proposed";

/** A propose_edit (or generate_image) result that refused the proposal. A
 *  stop's result isn't a refusal: what streamed is kept. */
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

/** What each status means for the model. The document it is shown holds only
 *  accepted edits; told nothing, it assumes its last proposal landed. */
const STATUS_NOTES: Record<PendingStatus, string> = {
  pending:
    "Status: the user has NOT yet accepted or rejected this proposed edit. It is shown to them as a preview and is NOT in the document text in this request - do not assume it was applied. To change it or go on from it, anchor in its text: the edit goes into this proposal.",
  // Still revealing/arguments still arriving - same consequence as pending.
  streaming:
    "Status: the user has NOT yet accepted or rejected this proposed edit. It is shown to them as a preview and is NOT in the document text in this request - do not assume it was applied. To change it or go on from it, anchor in its text: the edit goes into this proposal.",
  accepted:
    "Status: the user accepted this proposed edit - the document text in this request includes it.",
  rejected:
    "Status: the user rejected this proposed edit - it was not applied. Don't propose it again unless asked.",
  replaced:
    "Status: a later proposal of yours for the same passage took this one's place before the user decided on it - it was not applied, and the user didn't reject it.",
  invalid:
    "Status: this proposed edit could not be applied (the text it targeted changed) and was discarded - it is not part of the document.",
  expired:
    "Status: this proposed edit is from an earlier session and was never applied - it is not part of the document.",
  // A text edit or a picture made in another proposal.
  joined:
    "Status: this went into the proposed text it changes or goes next to - that proposal now reads with it, and it is accepted or rejected with that proposal.",
};

/** The history as sent, each proposal's tool result annotated with its
 *  current status. Applied on every send, never stored; results whose call
 *  id isn't in `statuses` pass through untouched. */
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
