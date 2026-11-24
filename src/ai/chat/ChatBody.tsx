import { fill } from "../../i18n/fill";
import { useFollowBottom } from "./useFollowBottom";
import { pictureSrc } from "../revision/generated-images";
import { MessageQueue } from "./MessageQueue";
import { useRef } from "react";
import { ChatMessages } from "./ChatMessages";
import type { ApplySuggestion } from "./CommentCard";
import { ErrorRow } from "./ErrorRow";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { MarkdownText } from "../MarkdownText";
import { QuickAskPendingBar } from "./quick-ask/QuickAskPendingBar";
import { quickSummary } from "./quick-summary";
import { usePhoneLayout } from "../../engine/controls/usePhoneLayout";
import { Presence, PresenceDiv } from "../../engine/motion/usePresence";
import type { ChatBodyProps } from "./chat-body-types";
import { useChatSend } from "./useChatSend";
import {
  useQuickExpanded,
  useRevealedStream,
  useStreamedProposals,
} from "./useChatBodyState";

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
  startWebSearch,
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
  const { history, streaming: received, busy, error, retryable } = conversation;
  const streaming = useRevealedStream(received, variant === "quick");
  const follow = useFollowBottom(received);
  const listRef = follow.ref;
  const { quickExpanded, toggleQuickExpanded } = useQuickExpanded(
    variant,
    busy,
    history,
    conversation.conversationId,
  );

  useStreamedProposals(received, onProposals);
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

  const ownComposer = useRef<ChatComposerHandle>(null);
  const composer = composerRef ?? ownComposer;
  const {
    queue,
    setQueue,
    queuePaused,
    goOn,
    insertQueued,
    handleSend,
    stopAll,
    handleRelocate,
    handleContinue,
    handleRetry,
  } = useChatSend(
    {
      conversation,
      document,
      selectionMarkdown,
      refreshContext,
      prepareMessage,
      onProposals,
      labels,
    },
    follow,
    composer,
  );

  const showMessages = history.length > 0 || busy || !!error || !!fillHeight;

  // Quick Ask's one line: its reply, its question, what it is doing.
  const quick =
    variant === "quick" ? quickSummary(history, streaming, busy, labels) : null;
  const summaryText = quick?.summaryText ?? null;
  const promptText = quick?.promptText ?? null;
  const quickHasMore = quick?.hasMore ?? false;
  const quickActivity = quick?.activity ?? null;

  // The conversation, in Quick Ask's transcript or the inline panel; only
  // the panel's proposals carry their own buttons.
  const messages = (
    <ChatMessages
      proposalActions={variant !== "quick"}
      history={history}
      streaming={received}
      onLiveGrow={follow.grow}
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
  );
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
                <div
                  className="tx-truncate quick-ask-prompt"
                  title={promptText}
                >
                  {promptText}
                </div>
              )}
              {!quickExpanded && !error && summaryText && (
                <div className="quick-ask-summary-row">
                  <div className="tx-cut-fade quick-ask-summary">
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
                  {messages}
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
              className="inline-chat-messages tx-scroll-reveal"
              ref={listRef}
              onScroll={follow.onScroll}
            >
              {messages}
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
                {fill(labels.pendingSummary, { n: String(pendingCount) })}
              </span>
              <div className="inline-chat-pending-actions">
                {onRevealPending && (
                  <button
                    className="tx-button small inline-chat-action"
                    onClick={onRevealPending}
                  >
                    {labels.pendingReveal}
                  </button>
                )}
                {/* With one edit its own card has Accept and Reject. */}
                {pendingCount > 1 && (
                  <>
                    <button
                      className="tx-button small inline-chat-action"
                      onClick={onAcceptAll}
                    >
                      {labels.proposalAcceptAll}
                    </button>
                    <button
                      className="tx-button small inline-chat-action"
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
        onInsert={insertQueued}
        onContinue={goOn}
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
        startWebSearch={startWebSearch}
        focusOnOpen={variant === "quick" || !phone}
        dockActions={dockActions}
        switchModels={variant !== "quick"}
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
