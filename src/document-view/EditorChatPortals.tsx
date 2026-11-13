import { useCallback } from "react";
import { createPortal } from "react-dom";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorSetup } from "./useEditorSetup";
import type { EditorChat } from "./useEditorChat";
import type { EditorReview } from "./useEditorReview";
import { InlineChat } from "../ai/chat/quick-ask/InlineChat";
import { useAttachDocument } from "../ai/chat/conversation/useAttachDocument";
import { chatLabels } from "../ai/chat/chat-labels";
import type { AgentMode, Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";

/** One tab's part in Textus AI's chats: in front, its document is what the
 *  window's conversations work on; Quick Ask is drawn in the document's
 *  flow or, on a phone, above the keyboard. */
export function EditorChatPortals({
  setup,
  chat,
  review,
  filePath,
  isActive,
  phone,
  tourMode,
  settings,
  t,
}: {
  setup: EditorSetup;
  chat: EditorChat;
  review: EditorReview;
  filePath: string | null;
  isActive: boolean;
  phone: boolean;
  /** The mode the tour's lesson sets in the composer. */
  tourMode: AgentMode | null;
  settings: Settings;
  t: Strings;
}) {
  const { run, inlineChat } = setup;
  const { pendingEdits, controls } = chat;
  const { chatGuard } = controls;
  const { notes } = review;
  const { handleFocusNext } = chat.review;
  // Kept while the notes are, so the panel's transcript isn't read again
  // at each of the editor's renders.
  const { noMargin, notes: noteList } = notes;
  const noteNumber = useCallback(
    (id: string) =>
      noMargin ? (noteList.find((n) => n.id === id)?.num ?? null) : null,
    [noMargin, noteList],
  );
  useAttachDocument(isActive, chat.proposals.port, {
    chat: {
      selectedText: chat.panelSelection?.text ?? null,
      selectionIsPicture: chat.panelSelection?.picture ?? false,
      selectionChip: chat.panelChipHandlers,
      tourMode,
      refreshContext: chat.bridge.panelSendContext,
      proposalStatus: pendingEdits.status,
      pendingCount: pendingEdits.decidable.length,
      onProposals: chat.proposals.showProposals,
      onAcceptProposal: pendingEdits.accept,
      proposalSentences: pendingEdits.sentences,
      onDecideSentence: pendingEdits.decide,
      onRevealProposal: review.revealProposal,
      onLocateText: notes.locateText,
      noteNumber,
      onRejectProposal: pendingEdits.reject,
      onAcceptAll: pendingEdits.acceptAll,
      onRejectAll: pendingEdits.rejectAll,
      onRevealPending: handleFocusNext,
    },
    documentText: () =>
      run((ctx) => ctx.get(editorViewCtx).state.doc.textContent) ?? "",
    onNewConversation: chat.startPanelConversation,
    onPopOut: chat.popOutPanel,
    guard: chat.panelGuard.asking,
    proceed: chat.panelGuard.proceed,
    cancelGuard: chat.panelGuard.cancel,
    writePaper: review.writePaper,
  });
  return (
    <>
      {inlineChat.chatInfo &&
        inlineChat.visible &&
        controls.quickAskHost &&
        // Portaled into the zone widget, a real block that pushes content
        // down instead of floating over it. On a phone, docked to the page.
        createPortal(
          <InlineChat
            document={inlineChat.chatInfo.document}
            sendContext={chat.bridge.quickSendContext}
            selectedText={inlineChat.chatInfo.selectedText}
            selectionMarkdown={inlineChat.chatInfo.selectionMarkdown}
            docPath={filePath}
            workspaceRoot={settings.agentWorkspaceRoot || null}
            conversation={chat.quickConversation}
            // Write first: Quick Ask is opened on a passage to change it.
            defaultMode="write"
            selectionChip={chat.quickChipHandlers}
            labels={chatLabels(t, settings.language)}
            onProposals={chat.proposals.showProposals}
            proposalStatus={pendingEdits.status}
            onAcceptProposal={pendingEdits.accept}
            onRejectProposal={pendingEdits.reject}
            onAcceptAll={pendingEdits.acceptAll}
            onRejectAll={pendingEdits.rejectAll}
            pendingCount={pendingEdits.decidable.length}
            focusIndex={pendingEdits.focusIndex}
            onFocusNext={handleFocusNext}
            onFocusPrevious={chat.review.handleFocusPrevious}
            onAcceptFocused={chat.review.handleAcceptFocused}
            onRejectFocused={chat.review.handleRejectFocused}
            onDetach={controls.expandQuickAsk}
            onNewConversation={controls.startNewAgentConversation}
            onRequestClose={() => controls.requestChatAction("close")}
            confirm={
              chatGuard
                ? {
                    onProceed: () => controls.performChatAction(chatGuard),
                    onCancel: () => {
                      controls.setChatGuard(null);
                      controls.chatComposer()?.focus();
                    },
                  }
                : null
            }
            docked={phone}
            onDockResize={controls.keepQuickAskTargetInView}
          />,
          controls.quickAskHost,
        )}
    </>
  );
}
