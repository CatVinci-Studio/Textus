import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { PendingEdits } from "./useEditorProposals";
import type { useChatContextBridge } from "./useChatContextBridge";
import { ChatBody } from "../ai/chat/ChatBody";
import { AgentPanelView } from "../ai/chat/panel/AgentPanelView";
import { CloseConfirmBar } from "../ai/chat/CloseConfirm";
import { ProjectBar } from "../ai/chat/panel/ProjectBar";
import type { AgentPanelFrame } from "../ai/chat/panel/agent-panel";
import { chatLabels } from "../ai/chat/chat-labels";
import type { AgentConversation } from "../ai/chat/useAgentConversation";
import type { EditProposal } from "../ai/types";
import { canDetachChat, isIOSApp } from "../platform/capabilities";
import { SparkleIcon } from "../ui/icons";
import type { Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";

/** What this editor draws in the docked AI panel (ai/chat/panel/) while it
 *  is the active tab: the conversation, and Memory. */
export function EditorAgentPanel({
  run,
  t,
  settings,
  filePath,
  onSkillUsed,
  agentPanel,
  conversation,
  pendingEdits,
  selectedText,
  panelSendContext,
  showProposals,
  onRevealProposal,
  onLocateText,
  noteNumber,
  onRevealPending,
  onNewConversation,
  onPopOut,
  guard,
  setGuard,
}: {
  run: EditorRunner;
  t: Strings;
  settings: Settings;
  filePath: string | null;
  /** A message went out through a skill (the tour's skills lesson). */
  onSkillUsed?: () => void;
  agentPanel: AgentPanelFrame;
  conversation: AgentConversation;
  pendingEdits: PendingEdits;
  selectedText: string | null;
  panelSendContext: ReturnType<typeof useChatContextBridge>["panelSendContext"];
  showProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  onRevealProposal: (callId: string, index: number) => void;
  onLocateText: (anchor: string, context?: string) => void;
  noteNumber: (id: string) => number | null;
  onRevealPending: () => void;
  onNewConversation: () => void;
  onPopOut: () => void;
  /** Starting a new conversation asked first (edits still undecided). */
  guard: boolean;
  setGuard: (guard: boolean) => void;
}) {
  return (
    <AgentPanelView
      labels={{
        title: t.agentPanelTitle,
        newConversation: t.chatNewConversation,
        popOut: t.agentPanelPopOut,
        close: t.chatClose,
        tabChat: t.agentTabChat,
        tabMemory: t.agentTabMemory,
      }}
      onNewConversation={onNewConversation}
      onPopOut={canDetachChat ? onPopOut : undefined}
      onClose={() => agentPanel.setOpen(false)}
      tab={agentPanel.tab}
      onTabChange={agentPanel.setTab}
      memory={() => (
        <ProjectBar
          docPath={filePath}
          memory
          documentText={
            run((ctx) => ctx.get(editorViewCtx).state.doc.textContent) ?? ""
          }
        />
      )}
    >
      {conversation.history.length === 0 && !conversation.busy && (
        <div className="agent-panel-empty">
          <span className="agent-panel-empty-mark" aria-hidden="true">
            <SparkleIcon />
          </span>
          <p className="agent-panel-empty-text">
            {/* No selecting-then-asking on a phone: the system's
                own text menu takes the long press. */}
            {isIOSApp ? t.agentPanelEmptyPhone : t.agentPanelEmpty}
          </p>
        </div>
      )}
      <ChatBody
        document=""
        selectedText={selectedText}
        selectionMarkdown={null}
        docPath={filePath}
        workspaceRoot={settings.agentWorkspaceRoot || null}
        conversation={conversation}
        defaultMode={settings.agentDefaultMode}
        defaultWebSearch={settings.enableWebSearch}
        onSkillUsed={onSkillUsed}
        labels={chatLabels(t, settings.language)}
        proposalStatus={pendingEdits.status}
        pendingCount={pendingEdits.decidable.length}
        fillHeight
        refreshContext={panelSendContext}
        onProposals={showProposals}
        onAcceptProposal={pendingEdits.accept}
        proposalSentences={pendingEdits.sentences}
        onDecideSentence={pendingEdits.decide}
        onRevealProposal={onRevealProposal}
        pendingBar={false}
        onLocateText={onLocateText}
        noteNumber={noteNumber}
        onRejectProposal={pendingEdits.reject}
        onAcceptAll={pendingEdits.acceptAll}
        onRejectAll={pendingEdits.rejectAll}
        onRevealPending={onRevealPending}
        footer={
          guard && (
            <CloseConfirmBar
              labels={chatLabels(t, settings.language)}
              pendingCount={pendingEdits.decidable.length}
              onAcceptAll={pendingEdits.acceptAll}
              onRejectAll={pendingEdits.rejectAll}
              onClose={() => {
                setGuard(false);
                conversation.reset();
              }}
              onCancel={() => setGuard(false)}
            />
          )
        }
      />
    </AgentPanelView>
  );
}
