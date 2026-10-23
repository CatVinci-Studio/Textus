import { createPortal } from "react-dom";
import { EditorAgentPanel } from "./EditorAgentPanel";
import type { EditorSetup } from "./useEditorSetup";
import type { EditorChat } from "./useEditorChat";
import type { EditorReview } from "./useEditorReview";
import { InlineChat } from "../ai/chat/quick-ask/InlineChat";
import { chatLabels } from "../ai/chat/chat-labels";
import type { AgentMode, Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";

/** Where one tab's chats are drawn: the docked AI panel, while this is
 *  the active tab and the panel is open, and Quick Ask - in the
 *  document's flow, or on a phone docked above the keyboard. */
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
      {/* Off, the panel shows that instead (app/AgentPanelDock.tsx). */}
      {panelContainer &&
        settings.textusAi &&
        createPortal(
          <EditorAgentPanel
            run={run}
            t={t}
            settings={settings}
            filePath={filePath}
            onSkillUsed={review.onSkillUsed}
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
        // The panel renders through a portal into the zone widget's DOM
        // container (quick-ask-widget-plugin) - a real block in the
        // document flow, so it pushes content below it down instead of
        // floating over it. On a phone, into the page, docked above the
        // keyboard.
        createPortal(
          <InlineChat
            document={inlineChat.chatInfo.document}
            sendContext={chat.bridge.quickSendContext}
            selectedText={inlineChat.chatInfo.selectedText}
            selectionMarkdown={inlineChat.chatInfo.selectionMarkdown}
            docPath={filePath}
            workspaceRoot={settings.agentWorkspaceRoot || null}
            conversation={chat.quickConversation}
            // Revise-first: Quick Ask is opened on a passage to change it,
            // and Review mode (the general default) turned "shorten this"
            // into a chat answer. Review stays one click away in the picker.
            defaultMode="revise"
            selectionChip={chat.quickChipHandlers}
            defaultWebSearch={settings.enableWebSearch}
            onSkillUsed={review.onSkillUsed}
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
