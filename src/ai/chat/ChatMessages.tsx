import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AgentTurnView, type AgentTurnLabels } from "./AgentTurnView";
import type { AgentTurn, EditAction, EditProposal } from "../types";
import type { PendingStatus } from "../revision/usePendingEdits";
import type { StreamingState } from "./useAgentConversation";
import { parseProposal } from "./proposal";
import { parseUserMessage } from "./user-message";
import { refusedProposalIds } from "../revision/proposal-status";
import { classifyAiError, type AiErrorKind } from "../error-messages";
import { diffLines } from "./line-diff";
import type { PendingSentence } from "../revision/pending-edit-plugin";
import { FlipOnChange } from "../../ui/flip";
import {
  MemoryChip,
  parseRememberResult,
  type MemoryChipLabels,
  type RememberResult,
} from "./MemoryChip";

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

export interface ChatMessagesLabels extends AgentTurnLabels, MemoryChipLabels {
  thinking: string;
  proposalTitle: string;
  proposalStatus: Record<Exclude<PendingStatus, "pending">, string>;
  proposalAccept: string;
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
  /** An add_comment card's title and jump-to-passage link. */
  commentTitle: string;
  commentLocate: string;
  /** Plain-language help per kind of provider failure (ErrorRow). */
  aiErrors: Record<AiErrorKind, string>;
}

export interface ChatMessagesProps {
  history: AgentTurn[];
  /** Live view of the in-flight exchange (turns landed so far + assistant
   *  prose being generated). Null when idle - and on providers without
   *  streaming, where the reply still arrives all at once via `history`. */
  streaming: StreamingState | null;
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
      else if (turn.kind === "ToolCall" && turn.name === "propose_edit")
        map.set(turn.call_id, {
          proposal: parseProposal(turn.arguments),
          sentSelection,
        });
    }
    return map;
  }, [shown]);
  // What each remember call saved, parsed once per turn-list change like
  // the proposals.
  const rememberResults = useMemo(() => {
    const remembers = new Set(
      shown.flatMap((turn) =>
        turn.kind === "ToolCall" && turn.name === "remember"
          ? [turn.call_id]
          : [],
      ),
    );
    const map = new Map<string, RememberResult>();
    for (const turn of shown) {
      if (turn.kind !== "ToolResult" || !remembers.has(turn.call_id)) continue;
      const result = parseRememberResult(turn.output);
      if (result) map.set(turn.call_id, result);
    }
    return map;
  }, [shown]);
  // A call the backend refused (tools.rs) was never a proposal: the model
  // was told and resends it, so it gets no card - nor its result.
  const refused = useMemo(() => refusedProposalIds(shown), [shown]);

  // A decided card shrinks to its status line; whatever is under it moves
  // up to meet it rather than jumping (FlipOnChange). Only decisions count:
  // a card ARRIVING (streaming -> pending) must not set it off, or the
  // "Thinking…" row below slides down through the new cards, drawn over
  // their text and buttons while they fade in.
  const decisions = shown
    .flatMap((turn) => {
      if (turn.kind !== "ToolCall" || turn.name !== "propose_edit") return [];
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
        if (
          (turn.kind === "ToolCall" || turn.kind === "ToolResult") &&
          refused.has(turn.call_id)
        )
          return null;
        if (turn.kind === "ToolCall" && turn.name === "propose_edit") {
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
        if (remembered)
          return (
            <div
              key={i}
              className={reveal ? "turn-reveal" : undefined}
              style={style}
            >
              <MemoryChip
                result={remembered}
                docPath={docPath}
                labels={labels}
              />
            </div>
          );
        return (
          <div
            key={i}
            className={reveal ? "turn-reveal" : undefined}
            style={style}
          >
            <AgentTurnView turn={turn} labels={labels} />
          </div>
        );
      })}
      {streaming && streaming.text.length > 0 && (
        <div className="turn-reveal agent-streaming">
          <AgentTurnView
            turn={{ kind: "Assistant", text: streaming.text }}
            labels={labels}
          />
        </div>
      )}
      {busy && !streaming?.text && (
        <ThinkingIndicator label={labels.thinking} />
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

/** The three-dot "thinking" row. Shared with ChatBody's quick variant so the
 *  two chat surfaces can't drift on this markup. */
export function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="agent-thinking">
      <span className="agent-thinking-label">{label}</span>
      <span className="agent-thinking-dots">
        <span />
        <span />
        <span />
      </span>
    </div>
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

const CHECK = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);
const CROSS = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

/**
 * One propose_edit call: what kind of edit it is and how many sentences it
 * changes, the model's reason, and one row of controls.
 *
 * The document is where an edit is read and decided: the text shows each
 * changed sentence struck with its replacement and a ✓ / ✕ (pending-edit-
 * plugin.ts). The card mirrors those sentences as a numbered list with the
 * same ✓ / ✕ - one decision, shown in both places - and its Accept takes
 * whatever wasn't kept ("Accept 1 of 2").
 *
 * The full line diff stays collapsed behind the size chips. The one state
 * that opens it is `invalid`: an anchor that couldn't be located leaves NO
 * in-document preview, so the card is then the only view of the content.
 */
function ProposalCard({
  callId,
  proposal,
  status,
  reveal,
  style,
  selectedText,
  labels,
  sentences,
  onDecide,
  onReveal,
  onAccept,
  onReject,
  onRelocate,
  actions = true,
}: {
  callId: string;
  proposal: EditProposal;
  status: PendingStatus;
  reveal: boolean;
  style: CSSProperties | undefined;
  selectedText: string | null;
  labels: ChatMessagesLabels;
  sentences: PendingSentence[] | null;
  onDecide?: (callId: string, index: number, take: boolean | null) => void;
  onReveal?: (callId: string, index: number) => void;
  onAccept: (callId: string, text?: string) => void;
  onReject: (callId: string) => void;
  onRelocate: (proposal: EditProposal) => void;
  actions?: boolean;
}) {
  const [diffOpen, setDiffOpen] = useState(status === "invalid");
  // A proposal that turns invalid after mounting (its preview resolved and
  // failed) must pop open - the card just became the only view of it.
  useEffect(() => {
    if (status === "invalid") setDiffOpen(true);
  }, [status]);

  // `append` has nothing to compare against; the others diff the text they
  // target against the replacement. replace_selection targets the captured
  // selection rather than a quoted anchor.
  const before =
    proposal.action === "append"
      ? ""
      : proposal.action === "replace_selection"
        ? (selectedText ?? "")
        : (proposal.anchor ?? "");
  const after =
    proposal.action === "delete"
      ? ""
      : proposal.action === "insert_before"
        ? `${proposal.text ?? ""}\n${before}`
        : proposal.action === "insert_after"
          ? `${before}\n${proposal.text ?? ""}`
          : (proposal.text ?? "");
  // Memoized because this re-renders on every streaming delta while a later
  // turn is still arriving, and the LCS diff is up to 400x400 lines.
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;

  const taken = sentences?.filter((s) => s.take !== false).length ?? 0;
  const partial = !!sentences && taken < sentences.length;

  return (
    <div
      className={`agent-proposal${reveal ? " turn-reveal" : ""}`}
      data-status={status}
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
            {sentences && sentences.length > 1
              ? labels.proposalChangeCount.replace(
                  "{n}",
                  String(sentences.length),
                )
              : labels.actionNames[proposal.action]}
          </span>
        </span>
        {/* Listed sentence by sentence below, the size chips (the full
            diff's toggle) only crowd the head - kept for the rest. */}
        {!(sentences && sentences.length > 1) && (
          <button
            type="button"
            className="agent-diff-summary"
            aria-expanded={diffOpen}
            title={diffOpen ? labels.diffCollapse : labels.diffShow}
            onClick={() => setDiffOpen(!diffOpen)}
          >
            {added > 0 && (
              <span className="agent-diff-chip agent-diff-add">+{added}</span>
            )}
            {removed > 0 && (
              <span className="agent-diff-chip agent-diff-remove">
                {"\u2212"}
                {removed}
              </span>
            )}
            <span className="agent-diff-caret" aria-hidden="true" />
          </button>
        )}
        {status === "pending" && onReveal && (
          <button
            type="button"
            className="agent-proposal-link agent-proposal-show"
            onClick={() => onReveal(callId, -1)}
          >
            {labels.proposalShowInText}
          </button>
        )}
      </div>
      {proposal.reason && (
        <div className="agent-proposal-reason">{proposal.reason}</div>
      )}
      {diffOpen && (
        <div className="agent-proposal-diff">
          {lines.map((line, i) => (
            <div key={i} className={`agent-diff-line agent-diff-${line.kind}`}>
              <span className="agent-diff-marker" aria-hidden="true">
                {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
              </span>
              <span className="agent-diff-text">{line.text || "\u00a0"}</span>
            </div>
          ))}
        </div>
      )}
      {sentences && sentences.length > 1 && (
        <ol className="agent-proposal-sentences">
          {sentences.map((s, k) => {
            const state =
              s.take === false ? "kept" : s.take === true ? "taken" : "open";
            return (
              <li key={k} data-state={state}>
                <button
                  type="button"
                  className="agent-proposal-sentence"
                  onClick={() => onReveal?.(callId, k)}
                >
                  <span className="agent-proposal-num">{k + 1}</span>
                  <span className="agent-proposal-sentence-text">
                    {(state === "kept" ? s.before : s.after).trim() ||
                      s.before.trim()}
                  </span>
                </button>
                {actions && onDecide && (
                  <span className="agent-proposal-pick">
                    <button
                      type="button"
                      className="pending-pick-take"
                      aria-pressed={s.take === true}
                      aria-label={labels.proposalTakeSentence}
                      title={labels.proposalTakeSentence}
                      onClick={() =>
                        onDecide(callId, k, s.take === true ? null : true)
                      }
                    >
                      {CHECK}
                    </button>
                    <button
                      type="button"
                      className="pending-pick-keep"
                      aria-pressed={s.take === false}
                      aria-label={labels.proposalKeepSentence}
                      title={labels.proposalKeepSentence}
                      onClick={() =>
                        onDecide(callId, k, s.take === false ? null : false)
                      }
                    >
                      {CROSS}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {status === "pending" ? (
        actions && (
          <div className="agent-proposal-actions">
            <button
              className="inline-chat-action inline-chat-action-primary"
              onClick={() => onAccept(callId)}
            >
              {partial && sentences
                ? labels.proposalAcceptSome
                    .replace("{k}", String(taken))
                    .replace("{n}", String(sentences.length))
                : labels.proposalAccept}
            </button>
            <button
              className="inline-chat-action"
              onClick={() => onReject(callId)}
            >
              {labels.proposalReject}
            </button>
          </div>
        )
      ) : status === "invalid" ? (
        // The anchor no longer resolves to exactly one place, so there's
        // nothing to preview and nothing safe to write. The only honest move
        // is to ask the model again against the document as it now reads -
        // applying this text blind is what the old direct-apply fallback
        // did, and it could land an edit somewhere the user never saw
        // highlighted.
        <>
          <div className="agent-proposal-status agent-proposal-status-invalid">
            {labels.proposalStatus.invalid}
          </div>
          <button
            className="inline-chat-action"
            onClick={() => onRelocate(proposal)}
          >
            {labels.proposalRelocate}
          </button>
        </>
      ) : (
        <div
          className={`agent-proposal-status agent-proposal-status-${status}`}
        >
          {labels.proposalStatus[status]}
        </div>
      )}
    </div>
  );
}
