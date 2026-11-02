import { useEffect, useRef } from "react";
import { ai } from "../../platform/ipc";
import { resolveSkillMessage } from "../../ai/chat/proposal";
import type { Strings } from "../../i18n/strings";
import { useSettings } from "../../prefs/SettingsContext";
import type { DocumentSnapshot } from "../../ai/doc-markdown";
import { ChatBody } from "../../ai/chat/ChatBody";
import { chatLabels } from "../../ai/chat/chat-labels";
import { useAgentConversation } from "../../ai/chat/useAgentConversation";
import {
  onCreateRequest,
  takeCreateRequest,
} from "../../ai/chat/create-request";
import { useLatest } from "../../utils/hooks/useLatest";

/** Nothing is being written: what is made goes in the reply, and is
 *  installed from the card under it. */
const NO_DOCUMENT: DocumentSnapshot = { markdown: "", blocks: [] };
const OPTIONS = { mode: "create", webSearch: false } as const;

/**
 * Create's conversation, from its first message on: Create mode only, no
 * document. Loaded when Create starts - the chat comes with the editor, not
 * with Settings. "Fix with AI" and the like, asked while it is open, are its
 * next message.
 */
export function CreateChat({
  t,
  kindLabel,
  first,
  onNew,
}: {
  t: Strings;
  kindLabel: string;
  /** Sent as it opens, its `/kind` resolved to that kind's skill. */
  first: string;
  /** Back to Create's start. */
  onNew: () => void;
}) {
  const { settings } = useSettings();
  const conversation = useAgentConversation(
    null,
    null,
    settings.aiProvider,
    false,
    settings.agentModels[settings.aiProvider] || undefined,
  );
  const send = useLatest((text: string) => {
    void conversation.send(NO_DOCUMENT, text, [], OPTIONS);
  });
  // Once, though StrictMode mounts it twice: with the built-in skills in,
  // so the first message carries its kind's.
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    ai.loadAgentWorkspace(null, null)
      .then((ws) => ws?.skills ?? [])
      .catch(() => [])
      .then((skills) => send.current(resolveSkillMessage(first, skills)));
  }, [send, first]);
  useEffect(
    () =>
      onCreateRequest(() => {
        const request = takeCreateRequest();
        if (request) send.current(request.text);
      }),
    [send],
  );

  return (
    <div className="create-studio create-studio-chat">
      <div className="create-studio-bar">
        <span className="create-studio-kind">{kindLabel}</span>
        <button
          type="button"
          className="text-button settings-inline-button"
          disabled={conversation.busy}
          onClick={onNew}
        >
          {t.createNew}
        </button>
      </div>
      <ChatBody
        document={NO_DOCUMENT}
        selectedText={null}
        selectionMarkdown={null}
        docPath={null}
        workspaceRoot={null}
        conversation={conversation}
        defaultMode="create"
        onlyMode="create"
        defaultWebSearch={false}
        labels={chatLabels(t, settings.language)}
        proposalStatus={() => "expired"}
        pendingCount={0}
        pendingBar={false}
        fillHeight
        onProposals={() => {}}
        onAcceptProposal={() => {}}
        onRejectProposal={() => {}}
        onAcceptAll={() => {}}
        onRejectAll={() => {}}
      />
    </div>
  );
}
