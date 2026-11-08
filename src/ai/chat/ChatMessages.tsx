import type { PendingStatus } from "../revision/usePendingEdits";
import { withoutCitationMarkers } from "../citation-markers";
import { OUT_OF_STEPS } from "./out-of-steps";
import {
  Fragment,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { AgentTurnView } from "./AgentTurnView";
import type { AgentTurn, EditProposal } from "../types";
import { ThoughtRow } from "./ThoughtRow";
import { isProposalTool, parseToolProposal } from "./proposal";
import { parseUserMessage } from "./user-message";
import { refusedProposalIds } from "../revision/proposal-status";
import { ErrorRow } from "./ErrorRow";
import { FlipOnChange } from "../../ui/flip";
import "../revision/pending-picture.css";
import {
  MemoryChip,
  parseRememberResult,
  type RememberResult,
} from "./MemoryChip";
import { ProposalCard, notMadeLine } from "./ProposalCard";
import { ProposalGroup, proposalRuns } from "./ProposalGroup";
import { CommentCard, CommentGroup, noteRunsOf } from "./CommentCard";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { memoryRunsOf } from "./memory-pass";
import { OFFER_SKILL, SkillOfferChip, parseSkillOffer } from "./SkillOfferChip";
import { PAPER_TURN, parsePaperCard } from "../paper/paper-store";
import { PaperCard } from "../paper/lazy";
import type { ChatMessagesProps } from "./chat-messages-types";

/** The statuses a card reaches by being decided, which collapse it. */
const DECIDED: ReadonlySet<PendingStatus> = new Set([
  "accepted",
  "rejected",
  "invalid",
]);

/**
 * The turn history: proposal cards, plain turns, and the busy/error states.
 * Streamed turns render at the same list indexes they settle at, so React
 * keeps the DOM nodes and nothing re-animates.
 */
export function ChatMessages({
  history,
  streaming,
  thoughts,
  busy,
  error,
  selectedText,
  labels,
  proposalStatus,
  onAcceptProposal,
  onRejectProposal,
  onRelocateProposal,
  proposalActions = true,
  proposalSentences,
  onDecideSentence,
  onRevealProposal,
  onLocateText,
  noteNumber,
  canRetry,
  onRetry,
  onContinue,
  docPath = null,
}: ChatMessagesProps) {
  const revealFrom = useRef(0);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (busy && !wasBusy.current) revealFrom.current = history.length;
    wasBusy.current = busy;
  }, [busy, history.length]);

  // Memoized on the turn lists, NOT on `streaming` itself: text deltas
  // replace the streaming object many times a second while reusing the
  // same turns array, and none of this depends on the text.
  const streamingTurns = streaming?.turns;
  // The live thinking row sits under the question; anything past the
  // question - a step's rows - pushes it up out of the panel's end.
  const thoughtAbove = (streamingTurns?.length ?? 0) > 1;
  // The step the row at the end names: the tool coming in, else the one
  // whose result came last, so a run of edits doesn't flick to "Thinking…".
  const lastTurn = streamingTurns?.at(-1);
  const step =
    streaming?.tool ??
    (lastTurn?.kind === "ToolCall"
      ? lastTurn.name
      : lastTurn?.kind === "ToolResult"
        ? streamingTurns?.find(
            (t): t is Extract<AgentTurn, { kind: "ToolCall" }> =>
              t.kind === "ToolCall" && t.call_id === lastTurn.call_id,
          )?.name
        : undefined);
  const shown = useMemo(
    () => (streamingTurns ? [...history, ...streamingTurns] : history),
    [history, streamingTurns],
  );

  // Filled while rendering: a comment's tool result renders nothing (the
  // card is the result), and it always follows its call in the list.
  const commentIds = new Set<string>();
  // With each, the selection its request went out with: the live one is
  // gone once the caret moves, and the card would count all addition.
  const parsedProposals = useMemo(() => {
    const map = new Map<
      string,
      { proposal: EditProposal | null; sentSelection: string | null }
    >();
    let sentSelection: string | null = null;
    for (const turn of shown) {
      if (turn.kind === "User")
        sentSelection = parseUserMessage(turn.text).selection;
      else if (turn.kind === "ToolCall" && isProposalTool(turn.name))
        map.set(turn.call_id, {
          proposal: parseToolProposal(turn.name, turn.arguments),
          sentSelection,
        });
    }
    return map;
  }, [shown]);
  // What each remember call saved, and one exchange's changes together as
  // one list under its first (the others render nothing).
  const { rememberResults, memoryRuns } = useMemo(() => {
    const remembers = new Set(
      shown.flatMap((turn) =>
        turn.kind === "ToolCall" && turn.name === "remember"
          ? [turn.call_id]
          : [],
      ),
    );
    const results = new Map<string, RememberResult>();
    for (const turn of shown) {
      if (turn.kind !== "ToolResult" || !remembers.has(turn.call_id)) continue;
      const result = parseRememberResult(turn.output);
      if (result) results.set(turn.call_id, result);
    }
    return {
      rememberResults: results,
      memoryRuns: memoryRunsOf(shown, results),
    };
  }, [shown]);
  // A call the backend refused was never a proposal: the model resends it,
  // so it gets no card. Proposals in a row form one card under the first.
  const { refused, runs } = useMemo(() => {
    const refused = refusedProposalIds(shown);
    return { refused, runs: proposalRuns(shown, parsedProposals, refused) };
  }, [shown, parsedProposals]);
  const inRun = new Set([...runs.values()].flatMap((run) => run.slice(1)));
  // A reply's notes, one call or several in a row, as one card under its
  // first call (an empty list under the others).
  const noteRuns = noteRunsOf(shown, noteNumber);
  const imageCalls = useMemo(
    () =>
      new Map(
        shown.flatMap((turn) =>
          turn.kind === "ToolCall" && turn.name === "generate_image"
            ? [[turn.call_id, turn.arguments] as const]
            : [],
        ),
      ),
    [shown],
  );

  // A decided card shrinks to its status line and what is under it slides
  // up. Only decisions count: an arriving card must not slide the
  // "Thinking…" row through the new cards.
  const decisions = shown
    .flatMap((turn) => {
      if (turn.kind !== "ToolCall" || !isProposalTool(turn.name)) return [];
      const status = proposalStatus(turn.call_id);
      return DECIDED.has(status) ? [`${turn.call_id}:${status}`] : [];
    })
    .join(" ");

  return (
    <>
      <FlipOnChange
        watch={decisions}
        targets={() =>
          document.querySelectorAll(
            ":is(.inline-chat-messages, .quick-ask-transcript) > *",
          )
        }
      />
      {shown.map((turn, i) => {
        const reveal = i >= revealFrom.current;
        // A CSS custom property, which CSSProperties doesn't type. The
        // stagger stops at the third turn.
        const style: CSSProperties | undefined = reveal
          ? ({
              "--reveal-delay": `${Math.min(i - revealFrom.current, 3) * 40}ms`,
            } as CSSProperties)
          : undefined;
        // A picture that wasn't made, where the user has something to do
        // about it: the request's limit, or no image model.
        const notMade =
          turn.kind === "ToolResult" &&
          refused.has(turn.call_id) &&
          imageCalls.has(turn.call_id)
            ? notMadeLine(imageCalls.get(turn.call_id) ?? "", labels)
            : null;
        if (notMade)
          return (
            <div
              key={i}
              className={`agent-tool-line agent-image-failed${reveal ? " turn-reveal" : ""}`}
              style={style}
            >
              {notMade}
            </div>
          );
        if (
          (turn.kind === "ToolCall" || turn.kind === "ToolResult") &&
          refused.has(turn.call_id)
        )
          return null;
        if (turn.kind === "ToolCall" && isProposalTool(turn.name)) {
          const parsed = parsedProposals.get(turn.call_id);
          const proposal = parsed?.proposal;
          if (!parsed || !proposal)
            return <AgentTurnView key={i} turn={turn} labels={labels} />;
          // While a request runs, a card can render a beat before its
          // preview is registered: still arriving, not expired.
          const statusOf = (id: string) => {
            const known = proposalStatus(id);
            return known === "expired" && busy ? "streaming" : known;
          };
          const status = statusOf(turn.call_id);
          const run = runs.get(turn.call_id);
          if (inRun.has(turn.call_id)) return null;
          if (run)
            return (
              <ProposalGroup
                key={i}
                items={run.map((id) => ({
                  callId: id,
                  proposal: parsedProposals.get(id)!.proposal!,
                  status: statusOf(id),
                }))}
                // Its first row was a card a moment ago: it takes that
                // card's place, not fading in from nothing again.
                reveal={false}
                style={style}
                labels={labels}
                actions={proposalActions}
                onAccept={onAcceptProposal}
                onReject={onRejectProposal}
                onReveal={onRevealProposal}
              />
            );
          return (
            <ProposalCard
              key={i}
              callId={turn.call_id}
              proposal={proposal}
              status={status}
              reveal={reveal}
              style={style}
              selectedText={parsed.sentSelection ?? selectedText}
              labels={labels}
              sentences={
                status === "pending"
                  ? (proposalSentences?.(turn.call_id) ?? null)
                  : null
              }
              onDecide={onDecideSentence}
              onReveal={onRevealProposal}
              onAccept={onAcceptProposal}
              onReject={onRejectProposal}
              onRelocate={onRelocateProposal}
              actions={proposalActions}
            />
          );
        }
        if (turn.kind === "ToolCall" && turn.name === "add_comment") {
          const run = noteRuns.get(turn.call_id);
          if (run) {
            commentIds.add(turn.call_id);
            if (run.length === 0) return null;
            if (run.length === 1)
              return (
                <CommentCard
                  key={i}
                  comment={run[0].comment}
                  num={run[0].num}
                  reveal={reveal}
                  style={style}
                  labels={labels}
                  onLocateText={onLocateText}
                />
              );
            return (
              <CommentGroup
                key={i}
                items={run}
                reveal={reveal}
                style={style}
                labels={labels}
                onLocateText={onLocateText}
              />
            );
          }
        }
        if (
          turn.kind === "ToolResult" &&
          (parsedProposals.has(turn.call_id) || commentIds.has(turn.call_id))
        )
          return null;
        // A skill offered after the exchange: its result is the offer.
        if (turn.kind === "ToolCall" && turn.name === OFFER_SKILL) return null;
        const offer =
          turn.kind === "ToolResult" &&
          turn.call_id.startsWith(`${OFFER_SKILL}-`) &&
          parseSkillOffer(turn.output);
        if (offer)
          return (
            <div
              key={i}
              className={`agent-memory-group${reveal ? " turn-reveal" : ""}`}
              style={style}
            >
              <SkillOfferChip offer={offer} docPath={docPath} />
            </div>
          );
        // A paper's card: its result says which paper.
        if (turn.kind === "ToolCall" && turn.name === PAPER_TURN) return null;
        const paper =
          turn.kind === "ToolResult" &&
          parsePaperCard(turn.call_id, turn.output);
        if (paper)
          return (
            <div
              key={i}
              className={reveal ? "turn-reveal" : undefined}
              style={style}
            >
              <Suspense fallback={null}>
                <PaperCard info={paper} />
              </Suspense>
            </div>
          );
        // A remember call shows as its result's chip; one that saved
        // nothing (a duplicate) shows as any other tool result.
        if (turn.kind === "ToolCall" && turn.name === "remember") return null;
        const remembered =
          turn.kind === "ToolResult" && rememberResults.get(turn.call_id);
        if (remembered) {
          const run = memoryRuns.get(turn.call_id);
          if (!run) return null;
          return (
            <div
              key={i}
              className={`agent-memory-group${reveal ? " turn-reveal" : ""}`}
              style={style}
            >
              {run.map((id) => (
                <MemoryChip
                  key={id}
                  result={rememberResults.get(id)!}
                  docPath={docPath}
                  labels={labels}
                />
              ))}
            </div>
          );
        }
        if (turn.kind === "Assistant" && turn.text === OUT_OF_STEPS)
          return (
            <div
              key={i}
              className={`agent-stopped${reveal ? " turn-reveal" : ""}`}
              style={style}
            >
              <span>{labels.stoppedAtLimit}</span>
              {onContinue && !busy && i === history.length - 1 && (
                <button
                  type="button"
                  className="inline-chat-action agent-stopped-continue"
                  onClick={onContinue}
                >
                  {labels.continueAfterLimit}
                </button>
              )}
            </div>
          );
        // An exchange's thinking sits under its question, above
        // everything the model did in answer.
        const thought =
          turn.kind !== "User"
            ? null
            : i === history.length
              ? (streaming?.thought ?? null)
              : (thoughts?.[i] ?? null);
        return (
          <Fragment key={i}>
            <div className={reveal ? "turn-reveal" : undefined} style={style}>
              <AgentTurnView turn={turn} labels={labels} />
            </div>
            {thought && <ThoughtRow thought={thought} labels={labels} />}
          </Fragment>
        );
      })}
      {streaming && streaming.text.length > 0 && (
        <div className="turn-reveal agent-streaming">
          <AgentTurnView
            turn={{
              kind: "Assistant",
              text: withoutCitationMarkers(streaming.text, true),
            }}
            labels={labels}
            live
          />
        </div>
      )}
      {/* Shown at the bottom once a step's rows push the thinking row out of
          sight, and under a reply once it has paused, so the panel never
          looks stuck. Re-keyed by each delta, it waits again. */}
      {busy && (streaming?.thought?.since == null || thoughtAbove) && (
        <ThinkingIndicator
          key={step ?? streaming?.text.length ?? 0}
          after={!!streaming?.text && !step}
          soon={!streaming?.text && !step && !streaming?.thought}
          waitedFor={labels.waitedFor}
          label={
            step === "generate_image"
              ? labels.generatingImage
              : step === "propose_edit"
                ? labels.writingEdit
                : step === "add_comment"
                  ? labels.writingNotes
                  : labels.thinking
          }
        />
      )}
      {error && (
        <ErrorRow
          error={error}
          retryLabel={labels.retry}
          onRetry={canRetry ? onRetry : null}
          explanations={labels.aiErrors}
        />
      )}
    </>
  );
}
