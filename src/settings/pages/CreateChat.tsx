import { useEffect, useRef, useState } from "react";
import { ai } from "../../platform/ipc";
import { resolveSkillMessage } from "../../ai/chat/proposal";
import type { Strings } from "../../i18n/strings";
import { useSettings } from "../../prefs/SettingsContext";
import type { DocumentSnapshot } from "../../ai/doc-markdown";
import type { AgentSkill } from "../../ai/types";
import { ChatBody } from "../../ai/chat/ChatBody";
import type { ChatComposerHandle } from "../../ai/chat/ChatComposer";
import { chatLabels } from "../../ai/chat/chat-labels";
import { ModeIcon } from "../../ai/chat/mode-icons";
import { useAgentConversation } from "../../ai/chat/useAgentConversation";
import {
  onCreateRequest,
  takeCreateRequest,
} from "../../ai/chat/create-request";
import { useLatest } from "../../utils/hooks/useLatest";
import { useBoxSlide } from "./useBoxSlide";
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

/**
 * Settings › Extensions › Create: a chat in Create mode, with no document.
 * Empty, its box sits in the middle with the kinds and a few starting
 * points; the first message calls the kind's skill, and the box goes down
 * under the conversation. Loaded with the chat, not with Settings. "Fix
 * with AI" and the like fill in the box before it starts, and are the next
 * message after.
 */
export function CreateChat({ t }: { t: Strings }) {
  const { settings } = useSettings();
  const conversation = useAgentConversation(
    null,
    null,
    settings.aiProvider,
    false,
    settings.agentModels[settings.aiProvider] || undefined,
  );
  const [kind, setKind] = useState<CreateKind>(KINDS[0]);
  // The built-in skills, so the first message carries its kind's.
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const composer = useRef<ChatComposerHandle>(null);
  const empty = conversation.history.length === 0 && !conversation.busy;

  const takeRequest = useLatest(() => {
    const request = takeCreateRequest();
    if (!request) return;
    if (!empty) {
      void conversation.send(NO_DOCUMENT, request.text, [], {
        mode: "create",
        webSearch: false,
      });
      return;
    }
    setKind(KINDS.includes(request.kind) ? request.kind : KINDS[0]);
    composer.current?.restore(request.text);
  });
  useEffect(() => {
    ai.loadAgentWorkspace(null, null)
      .then((ws) => setSkills(ws?.skills ?? []))
      .catch(() => {});
    takeRequest.current();
    return onCreateRequest(() => takeRequest.current());
  }, [takeRequest]);
  const slide = useBoxSlide(!empty);

  const kindLabel: Record<CreateKind, string> = {
    plugin: t.extensionsTabPlugins,
    theme: t.extensionsTabThemes,
    skill: t.extensionsTabSkills,
  };
  const labels = chatLabels(t, settings.language);

  return (
    <div
      ref={slide.ref}
      className={`create-studio${empty ? " create-studio-empty" : ""}`}
    >
      {!empty && (
        <div className="create-studio-bar">
          <span className="create-studio-kind">{kindLabel[kind]}</span>
          <button
            type="button"
            className="text-button settings-inline-button"
            disabled={conversation.busy}
            onClick={conversation.reset}
          >
            {t.createNew}
          </button>
        </div>
      )}
      {empty && (
        <div className="create-studio-hero">
          <span className="create-studio-mark" aria-hidden="true">
            <ModeIcon mode="create" />
          </span>
          <h2 className="create-studio-title">{t.createTitle}</h2>
          <p className="create-studio-intro">
            {settings.textusAi ? t.createIntro : t.createAiOff}
          </p>
        </div>
      )}
      {(settings.textusAi || !empty) && (
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
          labels={
            empty ? { ...labels, placeholder: t.createPlaceholder } : labels
          }
          composerRef={composer}
          prepareMessage={
            empty
              ? (message) => {
                  slide.mark();
                  return resolveSkillMessage(
                    createMessage(kind, message),
                    skills,
                  );
                }
              : undefined
          }
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
      )}
      {empty && settings.textusAi && (
        <div className="create-studio-start">
          <div
            className="create-studio-kinds"
            role="radiogroup"
            aria-label={t.createTitle}
          >
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className="create-studio-kind-chip"
                onClick={() => setKind(k)}
              >
                {kindLabel[k]}
              </button>
            ))}
          </div>
          <ul className="create-studio-examples" aria-label={t.createExamples}>
            {CREATE_EXAMPLES[kind].map((key) => (
              <li key={key}>
                <button
                  type="button"
                  className="create-studio-example"
                  onClick={() => composer.current?.restore(t[key] as string)}
                >
                  {t[key] as string}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
