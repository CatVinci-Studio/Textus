import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { useSettings } from "../../prefs/SettingsContext";
import { ai } from "../../platform/ipc";
import type { AgentSkill } from "../../ai/types";
import type { DocumentSnapshot } from "../../ai/doc-markdown";
import { ChatBody } from "../../ai/chat/ChatBody";
import { chatLabels } from "../../ai/chat/chat-labels";
import { resolveSkillMessage } from "../../ai/chat/proposal";
import { useAgentConversation } from "../../ai/chat/useAgentConversation";
import {
  onCreateRequest,
  takeCreateRequest,
  type CreateRequest,
} from "../../ai/chat/create-request";
import { useLatest } from "../../utils/hooks/useLatest";
import {
  CREATE_EXAMPLES,
  createKinds,
  createMessage,
  type CreateKind,
} from "./create-studio";

/** Nothing is being written: what is made goes in the reply, and is
 *  installed from the card under it. */
const NO_DOCUMENT: DocumentSnapshot = { markdown: "", blocks: [] };
const KINDS = createKinds();
const OPTIONS = { mode: "create", webSearch: false } as const;

/**
 * Settings › Extensions › Create: say what you want, and Textus AI makes the
 * plugin, theme or skill in a conversation of its own, here in the store -
 * installed, tried and changed without leaving it, and without touching the
 * document behind.
 */
export function CreateTab({ t }: { t: Strings }) {
  const { settings } = useSettings();
  const [kind, setKind] = useState<CreateKind>(KINDS[0]);
  const [text, setText] = useState("");
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const conversation = useAgentConversation(
    null,
    null,
    settings.aiProvider,
    false,
    settings.agentModels[settings.aiProvider] || undefined,
  );
  // The built-in skills, so the first message carries its kind's.
  useEffect(() => {
    let cancelled = false;
    ai.loadAgentWorkspace(null, null)
      .then((ws) => {
        if (!cancelled && ws?.skills) setSkills(ws.skills);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const kindLabel: Record<CreateKind, string> = {
    plugin: t.extensionsTabPlugins,
    theme: t.extensionsTabThemes,
    skill: t.extensionsTabSkills,
  };
  const started = conversation.history.length > 0 || conversation.busy;
  // "Edit with AI", "Fix with AI": a new start, filled in for the user to
  // finish - or, once a conversation is going, its next message.
  const take = useLatest((request: CreateRequest) => {
    if (started) {
      void conversation.send(NO_DOCUMENT, request.text, [], OPTIONS);
      return;
    }
    setKind(KINDS.includes(request.kind) ? request.kind : KINDS[0]);
    setText(request.text);
  });
  useEffect(() => {
    const takeWaiting = () => {
      const request = takeCreateRequest();
      if (request) take.current(request);
    };
    takeWaiting();
    return onCreateRequest(takeWaiting);
  }, [take]);
  const start = () => {
    if (!text.trim()) return;
    const message = resolveSkillMessage(createMessage(kind, text), skills);
    setText("");
    void conversation.send(NO_DOCUMENT, message, [], OPTIONS);
  };

  if (started)
    return (
      <div className="create-studio create-studio-chat">
        <div className="create-studio-bar">
          <span className="create-studio-kind">{kindLabel[kind]}</span>
          <button
            type="button"
            className="text-button settings-inline-button"
            disabled={conversation.busy}
            onClick={() => conversation.reset()}
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

  return (
    <div className="create-studio">
      <h2 className="create-studio-title">{t.createTitle}</h2>
      <p className="extensions-intro">{t.createIntro}</p>
      <div className="auth-tabs" role="radiogroup" aria-label={t.createTitle}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={`auth-tab${kind === k ? " auth-tab-active" : ""}`}
            onClick={() => setKind(k)}
          >
            {kindLabel[k]}
          </button>
        ))}
      </div>
      <textarea
        className="create-studio-input"
        rows={4}
        value={text}
        placeholder={t.createPlaceholder}
        aria-label={t.createPlaceholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
        }}
      />
      <div className="create-studio-actions">
        <button
          type="button"
          className="text-button settings-inline-button extensions-get-more"
          disabled={!text.trim() || !settings.textusAi}
          onClick={start}
        >
          {t.createStart}
        </button>
        {!settings.textusAi && (
          <span className="create-studio-note">{t.createAiOff}</span>
        )}
      </div>
      <section className="settings-group" aria-label={t.createExamples}>
        <h2 className="settings-group-title">{t.createExamples}</h2>
        <div className="create-studio-examples">
          {CREATE_EXAMPLES[kind].map((key) => (
            <button
              key={key}
              type="button"
              className="create-studio-example"
              onClick={() => setText(t[key] as string)}
            >
              {t[key] as string}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
