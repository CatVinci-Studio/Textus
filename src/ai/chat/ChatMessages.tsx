import type { PendingStatus } from "../revision/usePendingEdits";
import { withoutCitationMarkers } from "../citation-markers";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { AgentTurnView } from "./AgentTurnView";
import type { AgentTurn } from "../types";
import { isProposalTool } from "./proposal";
import { ErrorRow } from "./ErrorRow";
import { FlipOnChange } from "../../ui/flip";
import "../revision/pending-picture.css";
import { ThinkingIndicator } from "./ThinkingIndicator";
import type { ChatMessagesProps } from "./chat-messages-types";
import { itemOf, readTranscript } from "./chat-transcript";
import { ChatItem, ChatItems, type ChatItemsContext } from "./ChatItem";
import { AgentPermission } from "../agents/AgentPermission";

/** The statuses a card reaches by being decided, which collapse it. */
const DECIDED: ReadonlySet<PendingStatus> = new Set([
  "accepted",
  "rejected",
  "invalid",
]);

/**
 * The turn history as a list - each turn's item (chat-transcript.ts) drawn
 * by ChatItem - with the busy and error states at its end.
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
  onApplySuggestion,
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

  const transcript = useMemo(
    () => readTranscript(shown, noteNumber),
    [shown, noteNumber],
  );
  const items: ChatItemsContext = {
    labels,
    busy,
    selectedText,
    proposalStatus,
    onAcceptProposal,
    onRejectProposal,
    onRelocateProposal,
    proposalSentences,
    onDecideSentence,
    onRevealProposal,
    onLocateText,
    onApplySuggestion,
    onContinue,
    proposalActions,
    docPath,
    transcript,
  };

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
      <ChatItems.Provider value={items}>
        {shown.map((turn, i) => {
          const reveal = i >= revealFrom.current;
          // A CSS custom property, which CSSProperties doesn't type. The
          // stagger stops at the third turn.
          const style: CSSProperties | undefined = reveal
            ? ({
                "--reveal-delay": `${Math.min(i - revealFrom.current, 3) * 40}ms`,
              } as CSSProperties)
            : undefined;
          // An exchange's thinking sits under its question, above
          // everything the model did in answer.
          const thought =
            turn.kind !== "User"
              ? null
              : i === history.length
                ? (streaming?.thought ?? null)
                : (thoughts?.[i] ?? null);
          return (
            <ChatItem
              key={i}
              item={itemOf(turn, transcript)}
              arrival={{ reveal, style }}
              thought={thought}
              last={i === history.length - 1}
            />
          );
        })}
      </ChatItems.Provider>
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
      {streaming?.permission && (
        <AgentPermission
          pending={streaming.permission}
          label={labels.agentPermission}
        />
      )}
      {/* Shown at the bottom once a step's rows push the thinking row out of
          sight, and under a reply once it has paused, so the panel never
          looks stuck. Re-keyed by each delta, it waits again. */}
      {busy &&
        !streaming?.permission &&
        (streaming?.thought?.since == null || thoughtAbove) && (
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
