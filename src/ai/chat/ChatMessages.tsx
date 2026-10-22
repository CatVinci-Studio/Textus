import { withoutCitationMarkers } from "../citation-markers";
import { OUT_OF_STEPS } from "./out-of-steps";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { AgentTurnView, type AgentTurnLabels } from "./AgentTurnView";
import type { AgentTurn, EditAction, EditProposal } from "../types";
import type { PendingStatus } from "../revision/usePendingEdits";
import type { StreamingState } from "./useAgentConversation";
import type { Thought } from "./thought";
import { ThoughtRow, type ThoughtRowLabels } from "./ThoughtRow";
import { isProposalTool, parseToolProposal } from "./proposal";
import { parseUserMessage } from "./user-message";
import { refusedProposalIds } from "../revision/proposal-status";
import { classifyAiError, type AiErrorKind } from "../error-messages";
import type { PendingSentence } from "../revision/pending-edit-plugin";
import { FlipOnChange } from "../../ui/flip";
import "../revision/pending-picture.css";
import {
  MemoryChip,
  parseRememberResult,
  type MemoryChipLabels,
  type RememberResult,
} from "./MemoryChip";
import { ProposalCard, notGeneratedReason } from "./ProposalCard";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { memoryRunsOf } from "./memory-pass";

/** The statuses a card reaches by being decided, which collapse it. */
const DECIDED: ReadonlySet<PendingStatus> = new Set([
  "accepted",
  "rejected",
  "invalid",
]);

/** An add_comment call's arguments (src-tauri ai/tools.rs). */
function parseComment(
  argumentsJson: string,
): { anchor: string; comment: string; context?: string } | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    if (typeof parsed.anchor !== "string" || typeof parsed.comment !== "string")
      return null;
    return {
      anchor: parsed.anchor,
      comment: parsed.comment,
      context: typeof parsed.context === "string" ? parsed.context : undefined,
    };
  } catch {
    return null;
  }
}

export interface ChatMessagesLabels
  extends AgentTurnLabels, MemoryChipLabels, ThoughtRowLabels {
  thinking: string;
  /** "{n} seconds", after the indicator's label once nothing has moved
   *  for a while (ThinkingIndicator). */
  waitedFor: (seconds: number) => string;
  proposalTitle: string;
  proposalStatus: Record<Exclude<PendingStatus, "pending">, string>;
  proposalAccept: string;
  proposalPicturePainting: string;
  proposalReject: string;
  proposalAcceptAll: string;
  proposalRejectAll: string;
  /** Offered when an anchor no longer resolves - asks the model to re-issue
   *  the proposal against the document as it now reads. */
  proposalRelocate: string;
  /** Tooltips of the "+X −Y" chips that open and close the full diff. */
  diffCollapse: string;
  diffShow: string;
  actionNames: Record<EditAction, string>;
  retry: string;
  /** The Accept button while some sentences are kept as written: "{k}" of
   *  "{n}". */
  proposalAcceptSome: string;
  /** How many sentences a rewrite changes: "{n} changes". */
  proposalChangeCount: string;
  /** The ✓ / ✕ on a sentence (the card's and the text's). */
  proposalTakeSentence: string;
  proposalKeepSentence: string;
  /** Scrolls the document to the proposal. */
  proposalShowInText: string;
  /** The checkbox on a proposal that cites the web. */
  proposalSourcesAsFootnotes: string;
  /** An add_comment card's title and jump-to-passage link. */
  commentTitle: string;
  commentLocate: string;
  /** Plain-language help per kind of provider failure (ErrorRow). */
  aiErrors: Record<AiErrorKind, string>;
  /** A generate_image card's kind, and the line for a picture that wasn't
   *  made ("{reason}": the service's words). */
  proposalImage: string;
  imageNotGenerated: string;
  /** In place of "Thinking…" while a picture is being made. */
  generatingImage: string;
  /** In place of "Thinking…" while an edit's call streams in. */
  writingEdit: string;
  /** In place of "Thinking…" while a review note's call streams in. */
  writingNotes: string;
  /** The reply of an exchange that ran out of steps (OUT_OF_STEPS), and
   *  the button that asks it to go on. */
  stoppedAtLimit: string;
  continueAfterLimit: string;
}

export interface ChatMessagesProps {
  history: AgentTurn[];
  /** Live view of the in-flight exchange (turns landed so far + assistant
   *  prose being generated). Null when idle - and on providers without
   *  streaming, where the reply still arrives all at once via `history`. */
  streaming: StreamingState | null;
  /** Finished exchanges' thinking, by their user turn's index in
   *  `history` (useAgentConversation's `thoughts`). */
  thoughts?: Record<number, Thought>;
  /** Whether a live thought opens on its last lines, and the user's say
   *  on it (useAgentConversation's `followThinking`). */
  followThinking?: boolean;
  onFollowThinking?: (follow: boolean) => void;
  busy: boolean;
  error: string | null;
  selectedText: string | null;
  labels: ChatMessagesLabels;
  proposalStatus: (callId: string) => PendingStatus;
  /** `text`: a partial acceptance - see useSentenceChanges. */
  onAcceptProposal: (callId: string, text?: string) => void;
  /** A pending rewrite's sentences and the writer's call on each
   *  (usePendingEdits.sentences); absent where the document isn't reachable
   *  (the detached window), which shows the card without them. */
  proposalSentences?: (callId: string) => PendingSentence[] | null;
  /** A ✓ / ✕ on a card's sentence - the same decision as in the text. */
  onDecideSentence?: (
    callId: string,
    index: number,
    take: boolean | null,
  ) => void;
  /** Scrolls the document to a proposal's sentence (index -1: the whole
   *  proposal). */
  onRevealProposal?: (callId: string, index: number) => void;
  /** Jumps to an add_comment card's passage in the document; absent where
   *  the document isn't reachable (the detached window). */
  onLocateText?: (anchor: string, context?: string) => void;
  /** The number on an add_comment note's badge in the text, for its card
   *  to show the same; null while the note has none (a margin has room
   *  for it, or it was never placed). */
  noteNumber?: (callId: string) => number | null;
  onRejectProposal: (callId: string) => void;
  /** Asks the model to re-propose an edit whose anchor went stale. */
  onRelocateProposal: (proposal: EditProposal) => void;
  /** False where another control decides pending edits (Quick Ask's
   *  review bar) - the cards then show what each edit is, without a second
   *  set of Accept/Reject buttons. */
  proposalActions?: boolean;
  /** Set only when `error` came from a failed send whose (document, message)
   *  is still available to resend - not every error is retryable this way. */
  canRetry: boolean;
  onRetry: () => void;
  /** Asks the model to go on after an exchange ran out of steps; absent
   *  where nothing can be sent from here. */
  onContinue?: () => void;
  /** The conversation's document, whose project a remembered project
   *  memory belongs to (MemoryChip). */
  docPath?: string | null;
}

/**
 * The turn history: proposal cards, plain turns, and the busy/error states.
 * While a request runs, the streamed turns and the assistant prose being
 * generated render live after the settled history; when the request
 * resolves, the same turns re-enter via `history` at the same list indexes,
 * so React keeps the DOM nodes and nothing flickers or re-animates. Newly
 * arrived turns get a small staggered fade-in on top.
 *
 * The proposal card is the ONLY place an edit is accepted or rejected. The
 * document shows the same edit as red/green marks, but carries no controls of
 * its own - two sets of buttons for one action, on screen simultaneously, is
 * what this replaced.
 */
export function ChatMessages({
  history,
  streaming,
  thoughts,
  followThinking,
  onFollowThinking,
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
  const shown = useMemo(
    () => (streamingTurns ? [...history, ...streamingTurns] : history),
    [history, streamingTurns],
  );

  // propose_edit calls render as proposal cards (parsed here once per
  // turn-list change, NOT per render - streaming deltas re-render this
  // component many times a second and JSON.parse of a full edit per card
  // per delta added up); their paired tool results are backend->model
  // bookkeeping and would only add noise.
  // Filled while rendering: a comment's tool result renders nothing (the
  // card is the result), and it always follows its call in the list.
  const commentIds = new Set<string>();
  // With each, the selection its request went out with - what a
  // replace_selection rewrites. Not the live one: that is gone the moment
  // the caret moves, as it does after an undo puts the edit back on offer,
  // and the card then counted the rewrite as all addition ("+1", no "−1").
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
  // What each remember call saved, parsed once per turn-list change like
  // the proposals - and the changes of one exchange together, shown as one
  // list under its first (the others render nothing).
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
  // A call the backend refused (tools.rs) was never a proposal: the model
  // was told and resends it, so it gets no card - nor its result.
  const refused = useMemo(() => refusedProposalIds(shown), [shown]);
  const imageCalls = useMemo(
    () =>
      new Set(
        shown.flatMap((turn) =>
          turn.kind === "ToolCall" && turn.name === "generate_image"
            ? [turn.call_id]
            : [],
        ),
      ),
    [shown],
  );

  // A decided card shrinks to its status line; whatever is under it moves
  // up to meet it rather than jumping (FlipOnChange). Only decisions count:
  // a card ARRIVING (streaming -> pending) must not set it off, or the
  // "Thinking…" row below slides down through the new cards, drawn over
  // their text and buttons while they fade in.
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
        // A CSS custom property, not a standard style key - CSSProperties
        // doesn't type these, hence the cast. The stagger stops at the
        // third turn: a long reply should not take a second to show.
        const style: CSSProperties | undefined = reveal
          ? ({
              "--reveal-delay": `${Math.min(i - revealFrom.current, 3) * 40}ms`,
            } as CSSProperties)
          : undefined;
        // A picture that wasn't made: the reason, plainly, in the service's
        // own words where it gave any.
        if (
          turn.kind === "ToolResult" &&
          refused.has(turn.call_id) &&
          imageCalls.has(turn.call_id)
        )
          return (
            <div
              key={i}
              className={`agent-tool-line agent-image-failed${reveal ? " turn-reveal" : ""}`}
              style={style}
            >
              {labels.imageNotGenerated.replace(
                "{reason}",
                notGeneratedReason(turn.output),
              )}
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
          const known = proposalStatus(turn.call_id);
          // While a request runs, a card can render a beat before its
          // preview is registered (or, in the detached window, before the
          // editor's status push arrives) - that's still arriving, not
          // expired.
          const status = known === "expired" && busy ? "streaming" : known;
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
          const comment = parseComment(turn.arguments);
          if (comment) {
            commentIds.add(turn.call_id);
            const num = noteNumber?.(turn.call_id) ?? null;
            return (
              <div
                key={i}
                className={`agent-comment${reveal ? " turn-reveal" : ""}`}
                style={style}
              >
                <div className="agent-proposal-head">
                  {/* Where the text shows the note as a numbered badge,
                      the card wears the same number in its place. */}
                  {num !== null ? (
                    <span className="agent-comment-num">{num}</span>
                  ) : (
                    <span className="agent-comment-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16">
                        <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />
                      </svg>
                    </span>
                  )}
                  <span className="agent-proposal-title">
                    {labels.commentTitle}
                  </span>
                  {onLocateText && (
                    <button
                      type="button"
                      className="agent-proposal-link agent-proposal-show"
                      onClick={() =>
                        onLocateText(comment.anchor, comment.context)
                      }
                    >
                      {labels.commentLocate}
                    </button>
                  )}
                </div>
                <blockquote className="agent-comment-quote">
                  {comment.anchor}
                </blockquote>
                <div className="agent-comment-text">{comment.comment}</div>
              </div>
            );
          }
        }
        if (
          turn.kind === "ToolResult" &&
          (parsedProposals.has(turn.call_id) || commentIds.has(turn.call_id))
        )
          return null;
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
            {thought && (
              <ThoughtRow
                thought={thought}
                labels={labels}
                follow={followThinking}
                onFollow={onFollowThinking}
              />
            )}
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
          />
        </div>
      )}
      {/* While the thinking row counts the seconds, it says it all. Under
          a reply, it shows once the reply has stopped coming for a moment
          (re-keyed by each delta, it waits again): an edit's call, a
          picture's description or the next step can take seconds with
          nothing else moving, and the panel read as stuck (rc.6). */}
      {busy && streaming?.thought?.since == null && (
        <ThinkingIndicator
          key={streaming?.tool ? streaming.tool : (streaming?.text.length ?? 0)}
          after={!!streaming?.text && !streaming?.tool}
          soon={!streaming?.text && !streaming?.tool && !streaming?.thought}
          waitedFor={labels.waitedFor}
          label={
            streaming?.tool === "generate_image"
              ? labels.generatingImage
              : streaming?.tool === "propose_edit"
                ? labels.writingEdit
                : streaming?.tool === "add_comment"
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

/** The error row, with a retry button when the failed send is resendable
 *  (`onRetry` null otherwise). Shared with ChatBody's quick variant. */
export function ErrorRow({
  error,
  retryLabel,
  onRetry,
  explanations,
}: {
  error: string;
  retryLabel: string;
  onRetry: (() => void) | null;
  /** What to do, per recognized kind of failure (error-messages.ts). */
  explanations?: Partial<Record<AiErrorKind, string>>;
}) {
  const kind = classifyAiError(error);
  const explanation = kind ? explanations?.[kind] : undefined;
  return (
    <div className="agent-error">
      {explanation && (
        <div className="agent-error-explanation">{explanation}</div>
      )}
      <div className={explanation ? "agent-error-detail" : undefined}>
        {error}
      </div>
      {onRetry && (
        <button
          className="inline-chat-action agent-error-retry"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
