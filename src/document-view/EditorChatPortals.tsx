import { createPortal } from "react-dom";
import { EditorAgentPanel } from "./EditorAgentPanel";
import type { EditorSetup } from "./useEditorSetup";
import type { EditorChat } from "./useEditorChat";
import type { EditorReview } from "./useEditorReview";
import { InlineChat } from "../ai/chat/quick-ask/InlineChat";
import { chatLabels } from "../ai/chat/chat-labels";
import type { AgentMode, Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";

/** Where one tab's chats are drawn: the docked AI panel while active, and
 *  Quick Ask in the document's flow or, on a phone, above the keyboard. */
export function EditorChatPortals({
  setup,
  chat,
  review,
  filePath,
  phone,
  tourMode,
  settings,
  t,
}: {
  setup: EditorSetup;
  chat: EditorChat;
  review: EditorReview;
  filePath: string | null;
  phone: boolean;
  tourMode: AgentMode | null;
  settings: Settings;
  t: Strings;
}) {
  const { run, inlineChat } = setup;
  const { pendingEdits, panelContainer, controls } = chat;
  const { chatGuard } = controls;
  const { notes } = review;
  const { handleFocusNext } = chat.review;
  return (
    <>
      {/* Off, the panel shows that instead. */}
      {panelContainer &&
        settings.textusAi &&
        createPortal(
          <EditorAgentPanel
            run={run}
            t={t}
            settings={settings}
            filePath={filePath}
            tourMode={tourMode}
            agentPanel={chat.agentPanel}
            conversation={chat.conversation}
            pendingEdits={pendingEdits}
            selectedText={chat.panelSelection?.text ?? null}
            selectionIsPicture={chat.panelSelection?.picture ?? false}
            selectionChip={chat.panelChipHandlers}
            panelSendContext={chat.bridge.panelSendContext}
            showProposals={chat.proposals.showProposals}
            onRevealProposal={review.revealProposal}
            onLocateText={notes.locateText}
            noteNumber={(id) =>
              notes.noMargin
                ? (notes.notes.find((n) => n.id === id)?.num ?? null)
                : null
            }
            onRevealPending={handleFocusNext}
            onNewConversation={chat.startPanelConversation}
            onPopOut={chat.popOutPanel}
            guard={chat.panelGuard}
            setGuard={chat.setPanelGuard}
          />,
          panelContainer,
        )}
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
            defaultWebSearch={settings.enableWebSearch}
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
