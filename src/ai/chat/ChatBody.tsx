import type { DocumentSnapshot } from "../doc-markdown";
import { useFollowBottom } from "./useFollowBottom";
import { pictureSrc } from "../revision/generated-images";
import { MessageQueue } from "./MessageQueue";
import { useRef } from "react";
import type { AgentRequestOptions } from "./conversation/conversation-types";
import type {
  AgentTurn,
  ChatAttachment,
  EditProposal,
  ImageAttachment,
} from "../types";
import { ChatMessages } from "./ChatMessages";
import type { ApplySuggestion } from "./CommentCard";
import { afterFileChanges } from "./file-changes";
import { loadSettings } from "../../prefs/settings-store";
import { ErrorRow } from "./ErrorRow";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { MarkdownText } from "../MarkdownText";
import { QuickAskPendingBar } from "./quick-ask/QuickAskPendingBar";
import { quickSummary } from "./quick-summary";
import { usePhoneLayout } from "../../engine/controls/usePhoneLayout";
import { Presence, PresenceDiv } from "../../engine/motion/usePresence";
import { scrollBehavior } from "../../engine/motion/motion";
import { composeMessage } from "./user-message";
import { type ChatBodyProps, proposalsFromTurns } from "./chat-body-types";
import {
  useMessageQueue,
  useQuickExpanded,
  useRevealedStream,
  useStreamedProposals,
} from "./useChatBodyState";
export {
  type ChatBodyLabels,
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
  onResearch,
  kind,
  kinds,
  autoTools,
  prepareMessage,
  composerRef,
  footer,
  fillHeight,
  variant = "full",
  onlyMode,
  refreshContext,
  onRevealPending,
  quickReview,
  dockActions,
  selectionChip,
}: ChatBodyProps) {
  // A selection that is one picture has no text, so the chip shows the
  // picture's description (or its Markdown) and says so.
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
  const follow = useFollowBottom(streaming);
  const listRef = follow.ref;
  const { quickExpanded, toggleQuickExpanded } = useQuickExpanded(
    variant,
    busy,
    history,
    conversation.conversationId,
  );

  useStreamedProposals(streaming, onProposals);
  const applySuggestion: ApplySuggestion = (id, note) =>
    onProposals([
      {
        callId: `${id}:suggestion`,
        proposal: {
          action: "replace",
          block: note.block,
          anchor: note.anchor || undefined,
          text: note.suggestion,
          reason: note.comment,
        },
      },
    ]);

  function afterSend(newTurns: AgentTurn[] | undefined) {
    const proposals = proposalsFromTurns(newTurns ?? []);
    if (proposals.length > 0) onProposals(proposals);
    void afterFileChanges(
      conversation.conversationId,
      newTurns ?? [],
      loadSettings().aiChangeMode === "revision",
    );
    follow.stick();
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: scrollBehavior(),
      });
    });
  }

  /**
   * Composes a new message against the document as it reads at send time
   * (`refreshContext` first). Retry doesn't come through here: it resends the
   * failed message verbatim, against the document it was composed for.
   */
  function dispatchSend(
    buildMessage: (state: {
      document: DocumentSnapshot;
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

  // Messages sent while a reply is coming, sent in turn once the replies
  // before them finish. A failed reply pauses them; Stop gives them back.
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
  const ownComposer = useRef<ChatComposerHandle>(null);
  const composer = composerRef ?? ownComposer;

  function handleSend(
    typedMessage: string,
    attachments: ChatAttachment[],
    includeSelection: boolean,
    options: AgentRequestOptions,
    typed: string = typedMessage,
  ) {
    const message = prepareMessage?.(typedMessage) ?? typedMessage;
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

  /** An anchor that no longer resolves: ask the model to re-issue the edit
   *  against the document as it now reads, rather than writing text whose
   *  target we can't locate. */
  function handleRelocate(proposal: EditProposal) {
    dispatchSend(
      () => ({
        message: labels.relocateRequest.replace("{text}", proposal.text ?? ""),
      }),
      { mode: "write", webSearch: false },
    );
  }

  /** Continue, after an exchange ran out of steps: asks it to go on, the
   *  way the last message was sent. */
  function handleContinue() {
    dispatchSend(
      () => ({ message: labels.continueRequest }),
      conversation.lastOptions() ?? { mode: "write", webSearch: false },
    );
  }

  function handleRetry() {
    void (async () => {
      afterSend(await retry());
    })();
  }

  const showMessages = history.length > 0 || busy || !!error || !!fillHeight;

  // Quick Ask's one line: its reply, its question, what it is doing.
  const quick =
    variant === "quick" ? quickSummary(history, streaming, busy, labels) : null;
  const summaryText = quick?.summaryText ?? null;
  const promptText = quick?.promptText ?? null;
  const quickHasMore = quick?.hasMore ?? false;
  const quickActivity = quick?.activity ?? null;

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
                <div
                  className="quick-ask-transcript"
                  ref={listRef}
                  onScroll={follow.onScroll}
                >
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
                    onApplySuggestion={applySuggestion}
                    conversation={conversation.conversationId}
                    noteNumber={noteNumber}
                    onRejectProposal={onRejectProposal}
                    onRelocateProposal={handleRelocate}
                    canRetry={!!retryable}
                    onRetry={handleRetry}
                    onContinue={handleContinue}
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
            <div
              className="inline-chat-messages"
              ref={listRef}
              onScroll={follow.onScroll}
            >
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
                onApplySuggestion={applySuggestion}
                conversation={conversation.conversationId}
                noteNumber={noteNumber}
                onRejectProposal={onRejectProposal}
                onRelocateProposal={handleRelocate}
                canRetry={!!retryable}
                onRetry={handleRetry}
                onContinue={handleContinue}
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
        <Presence show={pendingBar && pendingCount > 0}>
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
        suggestions={conversation.suggestions}
        docPath={docPath}
        workspaceRoot={workspaceRoot}
        conversation={conversation.conversationId}
        selectedText={selectedPictureText ?? selectedText}
        selectionIsPicture={selectionIsPicture || selectedPictureText !== null}
        busy={busy}
        labels={labels}
        defaultMode={onlyMode ?? defaultMode}
        carryMode={variant !== "quick" && !onlyMode}
        onlyMode={onlyMode}
        tourMode={tourMode}
        selectionChip={selectionChip}
        selectionPerMessage={variant !== "quick"}
        compact={variant === "quick"}
        focusOnOpen={variant === "quick" || !phone}
        dockActions={dockActions}
        switchModels={variant !== "quick"}
        defaultWebSearch={defaultWebSearch}
        onSend={handleSend}
        onStop={stopAll}
        onEscape={onEscape ?? (() => {})}
        onModeChange={onModeChange}
        onResearch={onResearch}
        kind={kind}
        kinds={kinds}
        autoTools={autoTools}
      />
      {footer}
    </>
  );
}
