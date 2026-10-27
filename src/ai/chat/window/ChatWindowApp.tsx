import { useMemo } from "react";
import { useSettings } from "../../../prefs/SettingsContext";
import type { EditProposal } from "../../types";
import { ChatBody } from "../ChatBody";
import { chatLabels } from "../chat-labels";
import { CHAT_TO_EDITOR } from "./chat-bridge";
import { useChatWindowHandoff } from "./useChatWindowHandoff";
import { useChatWindowBridge } from "./useChatWindowBridge";
import { ChatWindowHeader } from "./ChatWindowHeader";
import { AppDialogHost } from "../../../ui/app-dialog";
// This window doesn't render App, so without this the theme's custom
// properties are never declared and the window is unstyled.
import "../../../ui/base.css";
import "../../../ui/app-dialog.css";
import "../AgentTurnView.css";
import "../inline-chat.css";
import { TextusAiOffNote } from "../../TextusAiSwitch";
import "./chat-window.css";

/**
 * The chat as its own OS window: the cross-file surface, following the user's
 * active document and selection. One per scope, so two never fight over an
 * editor. Edits are forwarded to the editor window, the one place they apply.
 */
export function ChatWindowApp() {
  const { t, settings, setSettings } = useSettings();
  const handoff = useChatWindowHandoff(settings);
  const { context, lost, claimed, conversation } = handoff;
  const pinned = settings.pinAgentWindow;
  const bridge = useChatWindowBridge({ handoff, pinned, t });
  const { docPath, requestDocPath, proposalDocs } = bridge;
  const { sendScoped, sendForProposal } = bridge;

  const labels = useMemo(
    () => chatLabels(t, settings.language),
    [t, settings.language],
  );

  const header = (
    <ChatWindowHeader
      context={context}
      busy={conversation.busy}
      pinned={pinned}
      reopenTarget={bridge.reopenTarget}
      onNewConversation={() => {
        proposalDocs.current.clear();
        conversation.reset();
      }}
      onPin={() => setSettings({ pinAgentWindow: !pinned })}
      t={t}
    />
  );

  // The history list's "document not found" question.
  const dialogs = <AppDialogHost okLabel={t.dialogOk} />;

  // Turned off - here or in any window - the conversation waits behind the
  // note, and comes back as it was once Textus AI is on again.
  if (!settings.textusAi)
    return (
      <div className="chat-window">
        {header}
        <TextusAiOffNote className="chat-window-ai-off" />
        {dialogs}
      </div>
    );
  if (lost)
    return (
      <div className="chat-window">
        {header}
        <div className="chat-window-lost">{t.chatWindowLost}</div>
        {dialogs}
      </div>
    );
  if (!claimed || !context)
    return (
      <div className="chat-window">
        {header}
        <div className="chat-window-loading">{t.agentThinking}</div>
        {dialogs}
      </div>
    );

  return (
    <div className="chat-window">
      {header}
      <div className="chat-window-body">
        <ChatBody
          document={context.document}
          selectedText={context.selectedText}
          selectionMarkdown={context.selectionMarkdown}
          docPath={context.docPath}
          workspaceRoot={settings.agentWorkspaceRoot || null}
          conversation={conversation}
          defaultMode={settings.agentDefaultMode}
          defaultWebSearch={settings.enableWebSearch}
          labels={labels}
          proposalStatus={bridge.proposalStatus}
          pendingCount={bridge.pendingCount}
          fillHeight
          refreshContext={bridge.refreshContext}
          onProposals={(
            proposals: { callId: string; proposal: EditProposal }[],
          ) => {
            const target = requestDocPath.current ?? docPath;
            for (const { callId } of proposals)
              proposalDocs.current.set(callId, target);
            sendScoped(CHAT_TO_EDITOR.proposals, { proposals }, target);
          }}
          onAcceptProposal={(callId) =>
            sendForProposal(CHAT_TO_EDITOR.accept, callId)
          }
          onRejectProposal={(callId) =>
            sendForProposal(CHAT_TO_EDITOR.reject, callId)
          }
          onAcceptAll={() => sendScoped(CHAT_TO_EDITOR.acceptAll, {})}
          onRejectAll={() => sendScoped(CHAT_TO_EDITOR.rejectAll, {})}
          selectionChip={{
            onChange: (chip) =>
              sendScoped(CHAT_TO_EDITOR.selectionChip, { chip }),
            onReveal: () => sendScoped(CHAT_TO_EDITOR.revealSelection, {}),
          }}
        />
      </div>
      {dialogs}
    </div>
  );
}
