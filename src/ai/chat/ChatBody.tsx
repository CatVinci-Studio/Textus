import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentConversation,
  AgentRequestOptions,
} from "./useAgentConversation";
import type { AgentMode } from "../../settings/SettingsContext";
import type { PendingStatus } from "../revision/usePendingEdits";
import type {
  AgentTurn,
  ChatAttachment,
  EditProposal,
  ImageAttachment,
} from "../types";
import {
  ChatMessages,
  ErrorRow,
  ThinkingIndicator,
  type ChatMessagesLabels,
  type ChatMessagesProps,
} from "./ChatMessages";
import {
  ChatComposer,
  type ChatComposerLabels,
  type SelectionChipHandlers,
} from "./ChatComposer";
import { MarkdownText } from "../MarkdownText";
import { useRevealedText } from "./useRevealedText";
import {
  QuickAskPendingBar,
  type QuickAskPendingBarLabels,
} from "./quick-ask/QuickAskPendingBar";
import { parseProposal } from "./proposal";
import { refusedProposalIds } from "../revision/proposal-status";
import { toolActivityText } from "./AgentTurnView";
import { usePhoneLayout } from "../../ui/usePhoneLayout";
import { Presence, PresenceDiv } from "../../ui/usePresence";
import { scrollBehavior } from "../../ui/motion";
import {
  attachedFileBlock,
  selectedTextBlock,
  cursorBlock,
  userMessageBody,
} from "./user-message";

export interface ChatBodyLabels
  extends ChatMessagesLabels, ChatComposerLabels, QuickAskPendingBarLabels {
  /** Sent as the user's message when relocating a stale proposal. */
  relocateRequest: string;
  /** Pinned pending-edits bar (full/window variant only); "{n}" is how many
   *  are undecided. */
  pendingSummary: string;
  pendingReveal: string;
  expandInline: string;
  collapseInline: string;
}

export interface ChatBodyProps {
  /** Document as markdown source - what the request is sent with. */
  document: string;
  /** Selection as plain text (composer chip) and as markdown (what the model
   *  is actually shown, so formatting survives - see doc-markdown.ts). */
  selectedText: string | null;
  selectionMarkdown: string | null;
  docPath: string | null;
  /** Explicit agent workspace root, or null for the document's own folder. */
  workspaceRoot: string | null;
  conversation: AgentConversation;
  defaultMode: AgentMode;
  defaultWebSearch: boolean;
  /** A message went out through a skill - see ChatComposer. */
  onSkillUsed?: () => void;
  labels: ChatBodyLabels;
  proposalStatus: (callId: string) => PendingStatus;
  pendingCount: number;
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  onAcceptProposal: (callId: string, text?: string) => void;
  /** See ChatMessages' proposalSentences, onDecideSentence and
   *  onRevealProposal - the card's view of the in-text decisions. */
  proposalSentences?: ChatMessagesProps["proposalSentences"];
  onDecideSentence?: ChatMessagesProps["onDecideSentence"];
  onRevealProposal?: ChatMessagesProps["onRevealProposal"];
  /** False where the editor's own review bar decides pending edits (the
   *  docked panel): the bar above the composer is then not drawn. */
  pendingBar?: boolean;
  /** See ChatMessages' onLocateText. */
  onLocateText?: (anchor: string, context?: string) => void;
  /** See ChatMessages' noteNumber. */
  noteNumber?: (callId: string) => number | null;
  onRejectProposal: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** Escape from the composer. The popup closes; a detached window doesn't
   *  (Escape shouldn't destroy an OS window the user placed deliberately). */
  onEscape?: () => void;
  /** Rendered above the composer - the popup's close-confirmation bar. */
  footer?: React.ReactNode;
  /** Jumps the editor to a pending edit. Absent in the detached window,
   *  which can't scroll another window's document. */
  onRevealPending?: () => void;
  /** The chat has a fixed height to fill (a resized panel, or a window), so
   *  the message list renders even while empty - it is the flexible region,
   *  and without it the composer would sit at the top of a blank panel. */
  fillHeight?: boolean;
  /** "quick" (the in-document Quick Ask bar) renders NO conversation - just
   *  a one-line reply summary, the pending bar, and the composer. Edits are
   *  the output; reading happens in the detached window ("full", default). */
  variant?: "quick" | "full";
  /** Detached window only: fetches the editor's document and selection as
   *  they read at this instant, immediately before a send.
   *
   *  The window is the cross-file surface, so it must not send against
   *  whatever was last pushed to it - the user may have typed, or moved to
   *  another file, since. Pulling once per send is exact and costs nothing
   *  in between; keeping a pushed copy fresh would mean re-serializing the
   *  whole document on every keystroke. Resolves null if the editor doesn't
   *  answer, in which case the last pushed context is used. */
  refreshContext?: () => Promise<{
    document: string;
    selectionMarkdown: string | null;
    /** Text around the caret when nothing is selected (cursorBlock). */
    cursor?: { before: string; after: string } | null;
    /** Heading of the section being worked in (AgentRequestOptions). */
    focusHeading?: string | null;
  } | null>;
  /** Quick variant only: the "review one at a time" nav bar's state/actions
   *  (usePendingEdits' focus* API), as one required-together object -
   *  without it the quick variant renders no pending bar at all, rather
   *  than a bar whose buttons silently do nothing. */
  quickReview?: QuickReview;
  /** Quick variant docked on a phone: the panel's own controls, shown in
   *  the composer's top row (ChatComposer's `dockActions`). */
  dockActions?: React.ReactNode;
  /** See ChatComposer's selectionChip. */
  selectionChip?: SelectionChipHandlers;
}

/** The Quick Ask nav bar's whole contract - see ChatBodyProps.quickReview. */
interface QuickReview {
  /** 0-based position of the currently focused edit, or -1 if none. */
  focusIndex: number;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  onAcceptFocused: () => void;
  onRejectFocused: () => void;
}

/**
 * The chat itself: turn list, proposal cards, composer, and the send
 * orchestration around them - everything that is the same whether the chat is
 * an embedded popup or its own window.
 *
 * It deliberately owns no document state and applies nothing. Proposals go
 * out through `onProposals` and accept/reject go out through their callbacks,
 * so the embedded case can call usePendingEdits directly while the detached
 * case forwards the identical calls to the editor window over the bridge.
 * Neither path has its own copy of the apply logic.
 */
/** The propose_edit tool calls in `turns`, parsed - what `onProposals`
 *  consumers (usePendingEdits directly, or the detached-window bridge)
 *  expect. Shared by the settled afterSend path and the live streamed-turn
 *  path so the two can't drift. */
function proposalsFromTurns(turns: AgentTurn[]) {
  const refused = refusedProposalIds(turns);
  return turns.flatMap((turn) => {
    if (turn.kind !== "ToolCall" || turn.name !== "propose_edit") return [];
    if (refused.has(turn.call_id)) return [];
    const proposal = parseProposal(turn.arguments);
    return proposal ? [{ callId: turn.call_id, proposal }] : [];
  });
}

/** The newest exchange: the last user message and every turn after it. */
function lastExchange(history: AgentTurn[]): {
  prompt: string | null;
  turns: AgentTurn[];
} {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn.kind === "User") {
      return { prompt: turn.text, turns: history.slice(i + 1) };
    }
  }
  return { prompt: null, turns: history };
}

/**
 * Whether the quick panel shows a finished exchange in full. A reply that
 * only answers opens expanded - the answer IS the result, and a five-line
 * clamp hid most of it. A reply that proposed edits stays compact: the
 * edits in the document are the result, and the pending bar is where they
 * are decided.
 */
export function quickReplyExpands(history: AgentTurn[]): boolean {
  const { turns } = lastExchange(history);
  const answered = turns.some(
    (turn) => turn.kind === "Assistant" && turn.text.trim().length > 0,
  );
  return answered && proposalsFromTurns(turns).length === 0;
}

export function ChatBody({
  document,
  selectedText,
  selectionMarkdown,
  docPath,
  workspaceRoot,
  conversation,
  defaultMode,
  defaultWebSearch,
  onSkillUsed,
  labels,
  proposalStatus,
  pendingCount,
  onProposals,
  onAcceptProposal,
  proposalSentences,
  onDecideSentence,
  onRevealProposal,
  pendingBar = true,
  onLocateText,
  noteNumber,
  onRejectProposal,
  onAcceptAll,
  onRejectAll,
  onEscape,
  footer,
  fillHeight,
  variant = "full",
  refreshContext,
  onRevealPending,
  quickReview,
  dockActions,
  selectionChip,
}: ChatBodyProps) {
  const phone = usePhoneLayout();
  const {
    history,
    streaming: received,
    busy,
    error,
    retryable,
    send,
    stop,
    retry,
  } = conversation;
  // The in-flight exchange as drawn: its prose paced onto the screen
  // (useRevealedText). The conversation keeps the text as received.
  const revealedText = useRevealedText(received?.text ?? "", !!received);
  const streaming = useMemo(
    () => received && { ...received, text: revealedText },
    [received, revealedText],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const [quickExpanded, setQuickExpanded] = useState(
    () => variant === "quick" && quickReplyExpands(history),
  );
  // Collapsing by hand is a choice for the rest of this conversation: later
  // answers in it arrive compact too. A new or restored conversation starts
  // over.
  const collapsedByUser = useRef(false);
  const shownConversation = useRef(conversation.conversationId);
  const awaitingReply = useRef(false);
  useEffect(() => {
    if (variant !== "quick") return;
    if (shownConversation.current !== conversation.conversationId) {
      shownConversation.current = conversation.conversationId;
      collapsedByUser.current = false;
      setQuickExpanded(quickReplyExpands(history));
      return;
    }
    if (busy) {
      awaitingReply.current = true;
      return;
    }
    if (!awaitingReply.current) return;
    awaitingReply.current = false;
    if (!collapsedByUser.current) setQuickExpanded(quickReplyExpands(history));
  }, [variant, busy, history, conversation.conversationId]);

  function toggleQuickExpanded() {
    collapsedByUser.current = quickExpanded;
    setQuickExpanded(!quickExpanded);
  }

  // Streamed turns become pending previews the moment they land, not when
  // the whole exchange resolves - a propose_edit shows up in the document
  // while the agent loop is still running. afterSend re-extracts the same
  // proposals afterwards; showPreviews adds are idempotent per callId, so
  // the second pass is a no-op for anything already shown here.
  const streamedTurnCount = useRef(0);
  useEffect(() => {
    if (!streaming) {
      streamedTurnCount.current = 0;
      return;
    }
    const fresh = streaming.turns.slice(streamedTurnCount.current);
    streamedTurnCount.current = streaming.turns.length;
    const proposals = proposalsFromTurns(fresh);
    if (proposals.length > 0) onProposals(proposals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming?.turns]);

  // Keep the newest streamed content in view while it grows.
  useEffect(() => {
    if (!streaming) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [streaming]);

  function afterSend(newTurns: AgentTurn[] | undefined) {
    const proposals = proposalsFromTurns(newTurns ?? []);
    if (proposals.length > 0) onProposals(proposals);
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: scrollBehavior(),
      });
    });
  }

  /**
   * Composes a NEW message and sends it - the user's own, and the relocate
   * request, which are the two that have to be written against the document
   * as it reads at send time rather than as it read when this component last
   * rendered. `buildMessage` therefore receives that state, pulled fresh
   * first (`refreshContext`): the detached window asks the editor over IPC,
   * the in-document bar reads its own editor - keeping the selection it
   * captured at open, which is what its rewrites target.
   *
   * `handleRetry` deliberately does NOT come through here: a retry resends
   * the failed message verbatim, against the document it was composed for
   * (useAgentConversation's RetryableSend), so re-resolving it would make
   * "retry" mean something else.
   */
  function dispatchSend(
    buildMessage: (state: {
      document: string;
      selectionMarkdown: string | null;
      cursor?: { before: string; after: string } | null;
    }) => { message: string; images?: ImageAttachment[] },
    options: AgentRequestOptions,
  ) {
    void (async () => {
      const latest = refreshContext ? await refreshContext() : null;
      const state = latest ?? { document, selectionMarkdown };
      const { message, images } = buildMessage(state);
      afterSend(
        await send(state.document, message, images, {
          ...options,
          focusHeading: latest?.focusHeading ?? null,
        }),
      );
    })();
  }

  function handleSend(
    message: string,
    attachments: ChatAttachment[],
    includeSelection: boolean,
    options: AgentRequestOptions,
  ) {
    dispatchSend(({ selectionMarkdown: selection, cursor }) => {
      // Rewrites of the selection come back as replace_selection tool calls
      // (see AGENT_TOOL_INSTRUCTIONS in src-tauri/src/ai/agent.rs); the tag
      // carries the selection's MARKDOWN so formatting survives the trip.
      // With nothing selected, the cursor's surroundings say where "here"
      // is (and where insert_at_cursor writes).
      const tagged =
        selection && includeSelection
          ? `${selectedTextBlock(selection)}\n\n${message}`
          : cursor
            ? `${cursorBlock(cursor.before, cursor.after)}\n\n${message}`
            : message;
      // Text-shaped attachments were already extracted in Rust (PDF, Word,
      // spreadsheets and plain files all arrive as text) and ride inside the
      // prompt. Images have nothing to extract and go as provider image
      // parts instead - see commands/attachment.rs.
      const attachmentBlocks = attachments
        .filter((f) => f.kind === "text")
        .map((f) => attachedFileBlock(f.name, f.content))
        .join("\n\n");
      return {
        message: attachmentBlocks ? `${attachmentBlocks}\n\n${tagged}` : tagged,
        // Not filtered on vision here: the composer refuses to stage an image
        // for a provider that can't read one, and the backend refuses the
        // whole message if one gets through anyway. Silently dropping it
        // would be a third policy contradicting both.
        images: attachments
          .filter((f) => f.kind === "image")
          .map((f) => ({
            name: f.name,
            mime: f.mime,
            dataBase64: f.dataBase64,
          })),
      };
    }, options);
  }

  /** An anchor that no longer resolves: ask the model to re-issue the edit
   *  against the document as it now reads, rather than writing text whose
   *  target we can't locate. */
  function handleRelocate(proposal: EditProposal) {
    dispatchSend(
      () => ({
        message: labels.relocateRequest.replace("{text}", proposal.text ?? ""),
      }),
      { mode: "revise", webSearch: false },
    );
  }

  function handleRetry() {
    void (async () => {
      afterSend(await retry());
    })();
  }

  const showMessages = history.length > 0 || busy || !!error || !!fillHeight;

  // The quick variant's one-line reply: live streamed prose while it
  // arrives, else the conversation's last assistant reply (so a restored
  // conversation shows where it left off).
  let summaryText: string | null = null;
  // The question the summary answers, echoed above it: once sent, the
  // composer is empty and nothing on screen said what had been asked.
  let promptText: string | null = null;
  // Whether the exchange holds more than its one-line summary - tool
  // steps, or a reply the summary clamps - and so earns "show all".
  let quickHasMore = false;
  // What the agent is doing right now (its latest tool call) - shown in
  // place of a bare "Thinking…" while a multi-step request works.
  let quickActivity: string | null = null;
  if (variant === "quick" && busy && streaming) {
    for (let i = streaming.turns.length - 1; i >= 0; i--) {
      const turn = streaming.turns[i];
      if (turn.kind === "ToolCall") {
        quickActivity = `${toolActivityText(turn.name, turn.arguments, labels)}…`;
        break;
      }
    }
  }
  if (variant === "quick") {
    // The exchange in progress counts as the newest one: its user turn only
    // reaches `history` when the reply completes, and until then the bar
    // showed the PREVIOUS question and answer with no sign of the new one.
    const exchange = lastExchange(
      busy && streaming ? [...history, ...streaming.turns] : history,
    );
    promptText = exchange.prompt
      ? userMessageBody(exchange.prompt).trim() || null
      : null;
    summaryText = streaming?.text || null;
    quickHasMore = exchange.turns.some(
      (turn) =>
        turn.kind === "ToolCall" ||
        (turn.kind === "Assistant" && turn.text.length > 160),
    );
    if (!summaryText && !busy) {
      for (let i = exchange.turns.length - 1; i >= 0; i--) {
        const turn = exchange.turns[i];
        if (turn.kind === "Assistant" && turn.text.trim()) {
          summaryText = turn.text;
          break;
        }
      }
    }
  }

  return (
    <>
      {variant === "quick"
        ? (busy || error || summaryText) && (
            <div
              className={`quick-ask-status${quickExpanded ? " quick-ask-status-expanded" : ""}`}
            >
              {!quickExpanded && error && (
                <ErrorRow
                  error={error}
                  retryLabel={labels.retry}
                  onRetry={retryable ? handleRetry : null}
                  explanations={labels.aiErrors}
                />
              )}
              {!quickExpanded && promptText && (
                <div className="quick-ask-prompt" title={promptText}>
                  {promptText}
                </div>
              )}
              {!quickExpanded && !error && summaryText && (
                <div className="quick-ask-summary-row">
                  <div className="quick-ask-summary">
                    <MarkdownText text={summaryText} />
                  </div>
                </div>
              )}
              {!quickExpanded && !error && busy && !summaryText && (
                <ThinkingIndicator label={quickActivity ?? labels.thinking} />
              )}
              {quickExpanded && (
                <div className="quick-ask-transcript" ref={listRef}>
                  <ChatMessages
                    proposalActions={false}
                    history={history}
                    streaming={streaming}
                    busy={busy}
                    error={error}
                    selectedText={selectedText}
                    labels={labels}
                    proposalStatus={proposalStatus}
                    onAcceptProposal={onAcceptProposal}
                    proposalSentences={proposalSentences}
                    onDecideSentence={onDecideSentence}
                    onRevealProposal={onRevealProposal}
                    onLocateText={onLocateText}
                    noteNumber={noteNumber}
                    onRejectProposal={onRejectProposal}
                    onRelocateProposal={handleRelocate}
                    canRetry={!!retryable}
                    onRetry={handleRetry}
                    docPath={docPath}
                  />
                </div>
              )}
              {(quickExpanded || quickHasMore) && (
                <button
                  type="button"
                  className="agent-proposal-link quick-ask-more"
                  aria-expanded={quickExpanded}
                  onClick={toggleQuickExpanded}
                >
                  {quickExpanded ? labels.collapseInline : labels.expandInline}
                </button>
              )}
            </div>
          )
        : showMessages && (
            <div className="inline-chat-messages" ref={listRef}>
              <ChatMessages
                history={history}
                streaming={streaming}
                busy={busy}
                error={error}
                selectedText={selectedText}
                labels={labels}
                proposalStatus={proposalStatus}
                onAcceptProposal={onAcceptProposal}
                proposalSentences={proposalSentences}
                onDecideSentence={onDecideSentence}
                onRevealProposal={onRevealProposal}
                onLocateText={onLocateText}
                noteNumber={noteNumber}
                onRejectProposal={onRejectProposal}
                onRelocateProposal={handleRelocate}
                canRetry={!!retryable}
                onRetry={handleRetry}
                docPath={docPath}
              />
            </div>
          )}
      {variant === "quick" ? (
        quickReview && (
          <QuickAskPendingBar
            total={pendingCount}
            focusIndex={quickReview.focusIndex}
            onFocusNext={quickReview.onFocusNext}
            onFocusPrevious={quickReview.onFocusPrevious}
            onAcceptFocused={quickReview.onAcceptFocused}
            onRejectFocused={quickReview.onRejectFocused}
            onAcceptAll={onAcceptAll}
            onRejectAll={onRejectAll}
            labels={labels}
          />
        )
      ) : (
        // Rises from the composer's edge with the first undecided edit
        // and goes back down after the last.
        <Presence show={pendingBar && pendingCount > 0} exitMs={150}>
          {pendingBar && pendingCount > 0 && (
            <PresenceDiv className="inline-chat-pending-bar">
              <span className="inline-chat-pending-count">
                {labels.pendingSummary.replace("{n}", String(pendingCount))}
              </span>
              <div className="inline-chat-pending-actions">
                {onRevealPending && (
                  <button
                    className="inline-chat-action"
                    onClick={onRevealPending}
                  >
                    {labels.pendingReveal}
                  </button>
                )}
                {/* With one edit its own card has Accept and Reject. */}
                {pendingCount > 1 && (
                  <>
                    <button
                      className="inline-chat-action"
                      onClick={onAcceptAll}
                    >
                      {labels.proposalAcceptAll}
                    </button>
                    <button
                      className="inline-chat-action"
                      onClick={onRejectAll}
                    >
                      {labels.proposalRejectAll}
                    </button>
                  </>
                )}
              </div>
            </PresenceDiv>
          )}
        </Presence>
      )}
      <ChatComposer
        docPath={docPath}
        workspaceRoot={workspaceRoot}
        selectedText={selectedText}
        busy={busy}
        labels={labels}
        defaultMode={defaultMode}
        carryMode={variant !== "quick"}
        selectionChip={selectionChip}
        selectionPerMessage={variant !== "quick"}
        compact={variant === "quick"}
        focusOnOpen={variant === "quick" || !phone}
        dockActions={dockActions}
        defaultWebSearch={defaultWebSearch}
        onSend={handleSend}
        onSkillUsed={onSkillUsed}
        onStop={stop}
        onEscape={onEscape ?? (() => {})}
      />
      {footer}
    </>
  );
}
