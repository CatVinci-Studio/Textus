import { pictureSrc } from "../revision/generated-images";
import { MessageQueue } from "./MessageQueue";
import { useEffect, useRef } from "react";
import type { AgentRequestOptions } from "./useAgentConversation";
import type {
  AgentTurn,
  ChatAttachment,
  EditProposal,
  ImageAttachment,
} from "../types";
import { ChatMessages, ErrorRow, ThinkingIndicator } from "./ChatMessages";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { MarkdownText } from "../MarkdownText";
import { QuickAskPendingBar } from "./quick-ask/QuickAskPendingBar";
import { toolActivityText } from "./AgentTurnView";
import { usePhoneLayout } from "../../ui/usePhoneLayout";
import { Presence, PresenceDiv } from "../../ui/usePresence";
import { scrollBehavior } from "../../ui/motion";
import { COMPOSER_MODES } from "./last-mode";
import {
  attachedFileBlock,
  selectedTextBlock,
  cursorBlock,
  userMessageBody,
} from "./user-message";
import {
  type ChatBodyProps,
  lastExchange,
  proposalsFromTurns,
} from "./chat-body-types";
import {
  useMessageQueue,
  useQuickExpanded,
  useRevealedStream,
  useStreamedProposals,
} from "./useChatBodyState";
export {
  type ChatBodyLabels,
  type ChatBodyProps,
  proposalsFromTurns,
  quickReplyExpands,
} from "./chat-body-types";

export function ChatBody({
  document,
  selectedText,
  selectionIsPicture = false,
  selectionMarkdown,
  docPath,
  workspaceRoot,
  conversation,
  defaultMode,
  tourMode,
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
  onModeChange,
  footer,
  fillHeight,
  variant = "full",
  refreshContext,
  onRevealPending,
  quickReview,
  dockActions,
  selectionChip,
}: ChatBodyProps) {
  // A selection that is one picture has no text: the composer would show
  // no chip at all, and say nothing of what goes with the message. It is
  // the picture's description (or its Markdown) there, and says so.
  const pictureMarkdown =
    pictureSrc(selectionMarkdown ?? "") !== null ? selectionMarkdown : null;
  const selectedPictureText = pictureMarkdown
    ? /^!\[([^\]]*)\]/.exec(pictureMarkdown.trim())?.[1] || pictureMarkdown
    : null;
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
  const streaming = useRevealedStream(received);
  const listRef = useRef<HTMLDivElement>(null);
  const { quickExpanded, toggleQuickExpanded } = useQuickExpanded(
    variant,
    busy,
    history,
    conversation.conversationId,
  );

  useStreamedProposals(streaming, onProposals);

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

  // Messages sent while a reply is coming (MessageQueue): composed as they
  // are sent, and sent in turn once the replies before them have finished
  // - against the document as it reads then. A failed reply pauses them
  // until Continue; Stop gives them back to the composer.
  const queueState = useMessageQueue(busy, async (next) => {
    const latest = refreshContext ? await refreshContext() : null;
    const turns = await send(
      latest?.document ?? document,
      next.message,
      next.images,
      { ...next.options, focusHeading: latest?.focusHeading ?? null },
    );
    afterSend(turns);
    return turns;
  });
  const { queue, setQueue, queuePaused, setQueuePaused } = queueState;
  const { nextQueued, sendingQueued } = queueState;
  const composer = useRef<ChatComposerHandle>(null);

  function handleSend(
    message: string,
    attachments: ChatAttachment[],
    includeSelection: boolean,
    options: AgentRequestOptions,
    typed: string = message,
  ) {
    const compose = (state: {
      selectionMarkdown: string | null;
      cursor?: { before: string; after: string } | null;
    }) => composeMessage(state, message, attachments, includeSelection);
    if (!busy && queue.length === 0 && !sendingQueued.current) {
      dispatchSend(compose, options);
      return;
    }
    void (async () => {
      const latest = refreshContext ? await refreshContext() : null;
      const composed = compose(latest ?? { selectionMarkdown });
      const id = nextQueued.current++;
      setQueue((now) => [...now, { id, typed, ...composed, options }]);
    })();
  }

  /** Stop drops the queue too: what was waiting goes back in the box. */
  function stopAll() {
    if (queue.length > 0)
      composer.current?.restore(queue.map((q) => q.typed).join("\n\n"));
    setQueue([]);
    setQueuePaused(false);
    stop();
  }

  function composeMessage(
    {
      selectionMarkdown: selection,
      cursor,
    }: {
      selectionMarkdown: string | null;
      cursor?: { before: string; after: string } | null;
    },
    message: string,
    attachments: ChatAttachment[],
    includeSelection: boolean,
  ): { message: string; images?: ImageAttachment[] } {
    // Rewrites of the selection come back as replace_selection tool calls
    // (see AGENT_TOOL_INSTRUCTIONS in src-tauri/src/ai/agent/prompt.rs); the tag
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
                <ThinkingIndicator
                  label={quickActivity ?? labels.thinking}
                  waitedFor={labels.waitedFor}
                />
              )}
              {quickExpanded && (
                <div className="quick-ask-transcript" ref={listRef}>
                  <ChatMessages
                    proposalActions={false}
                    history={history}
                    streaming={streaming}
                    thoughts={conversation.thoughts}
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
                thoughts={conversation.thoughts}
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
      <MessageQueue
        queue={queue}
        paused={queuePaused}
        labels={labels}
        onEdit={(id) => {
          const item = queue.find((q) => q.id === id);
          setQueue((now) => now.filter((q) => q.id !== id));
          if (item) composer.current?.restore(item.typed);
        }}
        onRemove={(id) => setQueue((now) => now.filter((q) => q.id !== id))}
        onContinue={() => setQueuePaused(false)}
      />
      <ChatComposer
        handle={composer}
        docPath={docPath}
        workspaceRoot={workspaceRoot}
        selectedText={selectedPictureText ?? selectedText}
        selectionIsPicture={selectionIsPicture || selectedPictureText !== null}
        busy={busy}
        labels={labels}
        defaultMode={defaultMode}
        modes={COMPOSER_MODES[variant]}
        carryMode={variant !== "quick"}
        tourMode={tourMode}
        selectionChip={selectionChip}
        selectionPerMessage={variant !== "quick"}
        compact={variant === "quick"}
        focusOnOpen={variant === "quick" || !phone}
        dockActions={dockActions}
        defaultWebSearch={defaultWebSearch}
        onSend={handleSend}
        onSkillUsed={onSkillUsed}
        onStop={stopAll}
        onEscape={onEscape ?? (() => {})}
        onModeChange={onModeChange}
      />
      {footer}
    </>
  );
}
