import { useMemo } from "react";
import { useSettings } from "../../../settings/SettingsContext";
import type { EditProposal } from "../../types";
import { ChatBody } from "../ChatBody";
import { chatLabels } from "../chat-labels";
import { CHAT_TO_EDITOR } from "./chat-bridge";
import { useChatWindowHandoff } from "./useChatWindowHandoff";
import { useChatWindowBridge } from "./useChatWindowBridge";
import { ChatWindowHeader } from "./ChatWindowHeader";
import { AppDialogHost } from "../../../ui/app-dialog";
// Every theme custom property (--editor-bg, --editor-text, --editor-border,
// ...) is declared on :root in ui/base.css. This window doesn't render App,
// so without this import every var() resolves to nothing and the whole
// window is unstyled; the dialogs' look comes along for its close prompt.
import "../../../ui/base.css";
import "../../../ui/app-dialog.css";
import "../AgentTurnView.css";
import "../inline-chat.css";
import { TextusAiOffNote } from "../../TextusAiSwitch";
import "./chat-window.css";

/**
 * The chat as its own OS window - and, deliberately, the CROSS-FILE surface.
 *
 * A real window rather than a webview-drawn panel, because the point of
 * detaching is to put it OUTSIDE the main window - which only the platform's
 * own window can do, along with native edge/corner resizing and multi-monitor
 * placement.
 *
 * The Agent's two surfaces divide by scope, not by size: the in-document
 * Quick Ask bar is about ONE file and keeps the snapshot it opened with,
 * while this window follows the user. Switch tabs or windows and its
 * document, title and selection follow; highlight a new passage and it
 * arrives here as a new selection chip. There is only ever one of these
 * windows per scope (see commands/chat_window.rs), which is what makes
 * "follows the user" coherent - two of them would fight over the same
 * editor.
 *
 * It renders the same ChatBody as the embedded popup and, like the popup,
 * owns no document state: proposals and accept/reject are forwarded to the
 * editor window (chat-bridge.ts), which stays the single place edits are
 * resolved and applied. Losing that would mean two implementations of the
 * anchor/apply logic drifting apart.
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

  // The history list's "document not found" question (app-dialog.tsx).
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
