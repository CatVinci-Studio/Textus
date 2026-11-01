import type { DocumentSnapshot } from "../ai/doc-markdown";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { PendingEdits } from "./useEditorProposals";
import type { useChatContextBridge } from "./useChatContextBridge";
import { ChatBody } from "../ai/chat/ChatBody";
import type { SelectionChipHandlers } from "../ai/chat/ChatComposer";
import { AgentPanelView } from "../ai/chat/panel/AgentPanelView";
import { ChatHistoryMenu } from "../ai/chat/ChatHistoryMenu";
import { reopenConversation } from "../ai/chat/reopen-conversation";
import { CloseConfirmBar } from "../ai/chat/CloseConfirm";
import { ProjectBar } from "../ai/chat/panel/ProjectBar";
import type { AgentPanelFrame } from "../ai/chat/panel/agent-panel";
import { chatLabels } from "../ai/chat/chat-labels";
import type { AgentConversation } from "../ai/chat/useAgentConversation";
import type { EditProposal } from "../ai/types";
import { canDetachChat } from "../platform/capabilities";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { Suspense, useState } from "react";
import { PaperLength } from "../ai/paper/lazy";
import { DEFAULT_PAPER_LENGTH } from "../ai/paper/paper-lengths";
import { ModeIcon } from "../ai/chat/mode-icons";
import type { AgentMode, PanelMode, Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";

/** The panel always asks for the document as it is now; this stands until
 *  it answers. */
const NO_DOCUMENT: DocumentSnapshot = { markdown: "", blocks: [] };

export function EditorAgentPanel({
  run,
  t,
  settings,
  filePath,
  onSkillUsed,
  tourMode,
  agentPanel,
  conversation,
  pendingEdits,
  selectedText,
  selectionIsPicture,
  selectionChip,
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
  writePaper,
}: {
  run: EditorRunner;
  t: Strings;
  settings: Settings;
  filePath: string | null;
  /** A message went out through a skill (the tour's skills lesson). */
  onSkillUsed?: () => void;
  /** The mode the tour's lesson sets in the composer. */
  tourMode: AgentMode | null;
  agentPanel: AgentPanelFrame;
  conversation: AgentConversation;
  pendingEdits: PendingEdits;
  selectedText: string | null;
  /** The selection is one picture. */
  selectionIsPicture: boolean;
  /** The chip's part in keeping the selection highlighted. */
  selectionChip: SelectionChipHandlers;
  panelSendContext: ReturnType<typeof useChatContextBridge>["panelSendContext"];
  showProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  onRevealProposal: (callId: string, index: number) => void;
  onLocateText: (anchor: string, block?: string) => void;
  noteNumber: (id: string) => number | null;
  onRevealPending: () => void;
  onNewConversation: () => void;
  onPopOut: () => void;
  /** Starting a new conversation asked first (edits still undecided). */
  guard: boolean;
  setGuard: (guard: boolean) => void;
  /** Starts a paper on a topic (usePaperWriter). */
  writePaper: (topic: string, targetChars: number) => void;
}) {
  // The composer's mode: the empty state says what the AI will do in it.
  const [mode, setMode] = useState<PanelMode>(settings.agentDefaultMode);
  // Research mode's paper length; the message sent is its topic.
  const [paperChars, setPaperChars] = useState(DEFAULT_PAPER_LENGTH);
  // The window bar's button opens and closes the panel; only the iPhone's
  // sheet keeps a close button of its own.
  const phone = usePhoneLayout();
  const emptyText = {
    write: t.agentPanelEmptyWrite,
    review: t.agentPanelEmptyReview,
    create: t.agentPanelEmptyCreate,
    research: t.agentPanelEmptyResearch,
  }[mode];
  return (
    <AgentPanelView
      labels={{
        title: t.agentPanelTitle,
        newConversation: t.chatNewConversation,
        popOut: t.agentPanelPopOut,
        close: t.chatClose,
        tabChat: t.agentTabChat,
        tabProject: t.agentTabProject,
      }}
      onNewConversation={onNewConversation}
      onPopOut={canDetachChat ? onPopOut : undefined}
      onClose={phone ? () => agentPanel.setOpen(false) : undefined}
      history={
        <ChatHistoryMenu
          buttonClassName="inline-chat-header-button"
          onReopen={(entry) => void reopenConversation(entry, t)}
        />
      }
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
            <ModeIcon key={mode} mode={mode} />
          </span>
          <p className="agent-panel-empty-text" key={mode}>
            {emptyText}
          </p>
        </div>
      )}
      <ChatBody
        document={NO_DOCUMENT}
        selectedText={selectedText}
        selectionIsPicture={selectionIsPicture}
        selectionChip={selectionChip}
        selectionMarkdown={null}
        docPath={filePath}
        workspaceRoot={settings.agentWorkspaceRoot || null}
        conversation={conversation}
        defaultMode={settings.agentDefaultMode}
        tourMode={tourMode}
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
        onModeChange={setMode}
        onResearch={(topic) => writePaper(topic, paperChars)}
        researchControls={
          <Suspense fallback={null}>
            <PaperLength t={t} value={paperChars} onChange={setPaperChars} />
          </Suspense>
        }
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
