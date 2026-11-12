import { HeadRow } from "../../engine/controls/HeadRow";
import { DropIcon, TakeIcon } from "../../engine/controls/icons";
import { counted } from "../../i18n/current";
import { fill } from "../../i18n/fill";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { FlipOnChange } from "../../engine/motion/flip";
import type { AgentTurn, EditProposal } from "../types";
import type { PendingStatus } from "../revision/usePendingEdits";
import { isProposalTool } from "./proposal";
import { Tooltip } from "../../engine/controls/Tooltip";
import { diffLines, lineCounts, proposalSides } from "./line-diff";
import { ChangeText } from "./ProposalCard";
import type { ChatMessagesLabels } from "./chat-messages-types";

/**
 * Two or more proposals one reply made in a row, shown as one card that
 * grows a row at a time as they stream. By its first call's id, the calls in
 * it; a call in a group but not first renders nothing. A picture keeps its
 * own card.
 */
export function proposalRuns(
  turns: AgentTurn[],
  parsed: Map<string, { proposal: EditProposal | null }>,
  refused: ReadonlySet<string>,
): Map<string, string[]> {
  const runs = new Map<string, string[]>();
  let run: string[] = [];
  const close = () => {
    if (run.length > 1) runs.set(run[0], run);
    run = [];
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
    if (!proposal || proposal.image) {
      close();
      continue;
    }
    run.push((turn as { call_id: string }).call_id);
  }
  close();
  return runs;
}

/** What follows `el` in its list - what its growing or shrinking moves. */
function following(el: Element | null): Element[] {
  const out: Element[] = [];
  for (let next = el?.nextElementSibling; next; next = next.nextElementSibling)
    out.push(next);
  return out;
}

/** Rows a group shows before "Show N more". */
const FOLDED_ROWS = 3;

/** One proposal of a group, as a row: its new text's start, its size, and
 *  ✓ / ✕ while it waits. */
function GroupRow({
  callId,
  proposal,
  status,
  selectedText,
  ownReason,
  labels,
  actions,
  onAccept,
  onReject,
  onReveal,
}: {
  callId: string;
  proposal: EditProposal;
  status: PendingStatus;
  /** What replace_selection targets: the selection sent. */
  selectedText?: string | null;
  /** Its reason, under it - the group's reasons differ. */
  ownReason: boolean;
  labels: ChatMessagesLabels;
  actions: boolean;
  onAccept: (callId: string) => void;
  onReject: (callId: string) => void;
  onReveal?: (callId: string, index: number) => void;
}) {
  const { before, after } = proposalSides(proposal, selectedText);
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const { added, removed } = lineCounts(lines);
  const pending = status === "pending";
  return (
    <li data-state={status}>
      <button
        type="button"
        className="agent-proposal-sentence"
        disabled={!pending || !onReveal}
        onClick={() => onReveal?.(callId, -1)}
      >
        <span className="agent-proposal-group-row-text">
          <span className="agent-proposal-sentence-text">
            <ChangeText
              markdown={(after || before).trim()}
              names={labels.proposalBlocks}
            />
          </span>
          {ownReason && proposal.reason && (
            <span className="tx-truncate agent-proposal-group-reason">
              {proposal.reason}
            </span>
          )}
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
                  <TakeIcon />
                </button>
              </Tooltip>
              <Tooltip text={labels.proposalReject}>
                <button
                  type="button"
                  className="pending-pick-keep"
                  aria-label={labels.proposalReject}
                  onClick={() => onReject(callId)}
                >
                  <DropIcon />
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

/** The card of a run of proposals: the reason once, a row each, and Accept
 *  all / Reject all for the ones still waiting. */
export function ProposalGroup({
  items,
  reveal,
  style,
  labels,
  actions = true,
  onAccept,
  onReject,
  onReveal,
  selectedText,
}: {
  items: { callId: string; proposal: EditProposal; status: PendingStatus }[];
  selectedText?: string | null;
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
  const done = waiting.length === 0 && !streaming;
  const reasons = new Set(items.map((item) => item.proposal.reason?.trim()));
  const shared = reasons.size === 1 ? items[0].proposal.reason : null;
  // Folded: its first rows, the rest behind "Show N more"; decided, all of
  // it behind its status line. A click opens it either way.
  const [unfolded, setUnfolded] = useState(false);
  // Its shape changing slides what is below it to its new place, on
  // transform: resized at once, the card would jump the reply under it.
  const ref = useRef<HTMLDivElement>(null);
  const shape = `${unfolded}:${items.map((i) => `${i.status}${i.proposal.text ? "+" : ""}`).join()}`;
  const rows = unfolded ? items : items.slice(0, FOLDED_ROWS);
  const hidden = items.length - rows.length;
  const decidedLine = [...new Set(items.map((item) => item.status))]
    .map((status) =>
      status === "pending" || status === "streaming"
        ? null
        : `${labels.proposalStatus[status]} ${items.filter((item) => item.status === status).length}`,
    )
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      ref={ref}
      className={`agent-proposal agent-proposal-group${reveal ? " turn-reveal" : ""}`}
      data-status={done ? "decided" : "pending"}
      style={style}
    >
      <FlipOnChange watch={shape} targets={() => following(ref.current)} />
      <HeadRow
        className="agent-proposal-head"
        mark={
          <span className="agent-proposal-icon" aria-hidden="true">
            <TakeIcon />
          </span>
        }
        title={
          <span className="agent-proposal-title">
            {labels.proposalTitle}
            <span className="agent-proposal-kind">
              {" · "}
              {counted(labels.proposalChangeCount, items.length)}
            </span>
          </span>
        }
      />
      {done && !unfolded ? (
        <button
          type="button"
          className="agent-proposal-group-fold"
          aria-expanded={false}
          onClick={() => setUnfolded(true)}
        >
          {decidedLine}
        </button>
      ) : (
        <>
          {shared && <div className="agent-proposal-reason">{shared}</div>}
          <ol className="agent-proposal-sentences agent-proposal-group-rows">
            {rows.map((item) => (
              <GroupRow
                key={item.callId}
                {...item}
                selectedText={selectedText}
                ownReason={!shared}
                labels={labels}
                actions={actions}
                onAccept={onAccept}
                onReject={onReject}
                onReveal={onReveal}
              />
            ))}
          </ol>
          {(hidden > 0 || unfolded) && items.length > FOLDED_ROWS && (
            <button
              type="button"
              className="agent-proposal-group-fold"
              aria-expanded={unfolded}
              onClick={() => setUnfolded(!unfolded)}
            >
              {unfolded
                ? labels.proposalGroupLess
                : fill(labels.proposalGroupMore, { n: String(hidden) })}
            </button>
          )}
        </>
      )}
      {/* There from the first row: shown only once the run was all in, it
          would grow the card under the reader. */}
      {actions && !done && (
        <div className="agent-proposal-actions">
          <button
            className="inline-chat-action inline-chat-action-primary"
            disabled={streaming}
            onClick={() => waiting.forEach((item) => onAccept(item.callId))}
          >
            {labels.proposalAcceptAll}
          </button>
          <button
            className="inline-chat-action"
            disabled={streaming}
            onClick={() => waiting.forEach((item) => onReject(item.callId))}
          >
            {labels.proposalRejectAll}
          </button>
        </div>
      )}
    </div>
  );
}
