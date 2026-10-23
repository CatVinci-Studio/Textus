import { useMemo, type CSSProperties } from "react";
import type { AgentTurn, EditProposal } from "../types";
import type { PendingStatus } from "../revision/usePendingEdits";
import { isProposalTool } from "./proposal";
import { Tooltip } from "../../ui/Tooltip";
import { diffLines } from "./line-diff";
import { CHECK, CROSS, ChangeText } from "./ProposalCard";
import type { ChatMessagesLabels } from "./ChatMessages";

/**
 * Proposals one reply made one after another for the same reason - a
 * translation, a paragraph at a time - shown as one card (ProposalGroup):
 * as cards of their own they were a column of the same card, "Translate
 * this paragraph" six times over. By its first call's id, the calls in it;
 * a call in a group but not first renders nothing. A picture keeps its own
 * card, as does a reason said once.
 */
export function proposalRuns(
  turns: AgentTurn[],
  parsed: Map<string, { proposal: EditProposal | null }>,
  refused: ReadonlySet<string>,
): Map<string, string[]> {
  const runs = new Map<string, string[]>();
  let run: string[] = [];
  let reason: string | null = null;
  const close = () => {
    if (run.length > 1) runs.set(run[0], run);
    run = [];
    reason = null;
  };
  for (const turn of turns) {
    // A call's result, and calls refused and sent again, stand between the
    // calls of a run without breaking it.
    if (turn.kind === "ToolResult") continue;
    if (turn.kind === "ToolCall" && refused.has(turn.call_id)) continue;
    const proposal =
      turn.kind === "ToolCall" && isProposalTool(turn.name)
        ? parsed.get(turn.call_id)?.proposal
        : null;
    const why = proposal?.reason?.trim();
    if (!proposal || !why || proposal.image) {
      close();
      continue;
    }
    if (why !== reason) close();
    reason = why;
    run.push((turn as { call_id: string }).call_id);
  }
  close();
  return runs;
}

/** One proposal of a group, as a row: its new text's start, its size, and
 *  ✓ / ✕ while it waits. */
function GroupRow({
  callId,
  proposal,
  status,
  labels,
  actions,
  onAccept,
  onReject,
  onReveal,
}: {
  callId: string;
  proposal: EditProposal;
  status: PendingStatus;
  labels: ChatMessagesLabels;
  actions: boolean;
  onAccept: (callId: string) => void;
  onReject: (callId: string) => void;
  onReveal?: (callId: string, index: number) => void;
}) {
  const before = proposal.anchor ?? "";
  const after = proposal.action === "delete" ? "" : (proposal.text ?? "");
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;
  const pending = status === "pending";
  return (
    <li data-state={status}>
      <button
        type="button"
        className="agent-proposal-sentence"
        disabled={!pending || !onReveal}
        onClick={() => onReveal?.(callId, -1)}
      >
        <span className="agent-proposal-sentence-text">
          <ChangeText
            markdown={(after || before).trim()}
            names={labels.proposalBlocks}
          />
        </span>
      </button>
      {pending ? (
        <>
          <span className="agent-diff-summary">
            {added > 0 && (
              <span className="agent-diff-chip agent-diff-add">+{added}</span>
            )}
            {removed > 0 && (
              <span className="agent-diff-chip agent-diff-remove">
                {"−"}
                {removed}
              </span>
            )}
          </span>
          {actions && (
            <span className="agent-proposal-pick">
              <Tooltip text={labels.proposalAccept}>
                <button
                  type="button"
                  className="pending-pick-take"
                  aria-label={labels.proposalAccept}
                  onClick={() => onAccept(callId)}
                >
                  {CHECK}
                </button>
              </Tooltip>
              <Tooltip text={labels.proposalReject}>
                <button
                  type="button"
                  className="pending-pick-keep"
                  aria-label={labels.proposalReject}
                  onClick={() => onReject(callId)}
                >
                  {CROSS}
                </button>
              </Tooltip>
            </span>
          )}
        </>
      ) : (
        status !== "streaming" && (
          <span className="agent-proposal-group-status">
            {labels.proposalStatus[status]}
          </span>
        )
      )}
    </li>
  );
}

/** The card of a run of proposals (proposalRuns): the reason once, a row
 *  each, and Accept all / Reject all for the ones still waiting. */
export function ProposalGroup({
  items,
  reveal,
  style,
  labels,
  actions = true,
  onAccept,
  onReject,
  onReveal,
}: {
  items: { callId: string; proposal: EditProposal; status: PendingStatus }[];
  reveal: boolean;
  style: CSSProperties | undefined;
  labels: ChatMessagesLabels;
  actions?: boolean;
  onAccept: (callId: string) => void;
  onReject: (callId: string) => void;
  onReveal?: (callId: string, index: number) => void;
}) {
  const waiting = items.filter((item) => item.status === "pending");
  const streaming = items.some((item) => item.status === "streaming");
  return (
    <div
      className={`agent-proposal agent-proposal-group${reveal ? " turn-reveal" : ""}`}
      data-status={waiting.length > 0 || streaming ? "pending" : "decided"}
      style={style}
    >
      <div className="agent-proposal-head">
        <span className="agent-proposal-icon" aria-hidden="true">
          {CHECK}
        </span>
        <span className="agent-proposal-title">
          {labels.proposalTitle}
          <span className="agent-proposal-kind">
            {" · "}
            {labels.proposalChangeCount.replace("{n}", String(items.length))}
          </span>
        </span>
      </div>
      <div className="agent-proposal-reason">{items[0].proposal.reason}</div>
      <ol className="agent-proposal-sentences agent-proposal-group-rows">
        {items.map((item) => (
          <GroupRow
            key={item.callId}
            {...item}
            labels={labels}
            actions={actions}
            onAccept={onAccept}
            onReject={onReject}
            onReveal={onReveal}
          />
        ))}
      </ol>
      {actions && waiting.length > 1 && !streaming && (
        <div className="agent-proposal-actions">
          <button
            className="inline-chat-action inline-chat-action-primary"
            onClick={() => waiting.forEach((item) => onAccept(item.callId))}
          >
            {labels.proposalAcceptAll}
          </button>
          <button
            className="inline-chat-action"
            onClick={() => waiting.forEach((item) => onReject(item.callId))}
          >
            {labels.proposalRejectAll}
          </button>
        </div>
      )}
    </div>
  );
}
