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
import { useOwnConversation } from "../../ai/chat/conversation/useConversation";
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
/** The starting points under the empty box, one of each kind. */
const EXAMPLES = KINDS.map((k) => [k, CREATE_EXAMPLES[k]] as const);

/**
 * Settings › Extensions › Create: a chat in Create mode, with no document,
 * that always searches and thinks. Empty, its box sits in the middle over a
 * few starting points; `/` in it picks what to make - unpicked, the model
 * tells from the request - and the first message goes down under the
 * conversation. Loaded with the chat, not with Settings. "Fix with AI" and
 * the like fill in the box before it starts, and are the next message after.
 */
export function CreateChat({ t }: { t: Strings }) {
  const { settings } = useSettings();
  const conversation = useOwnConversation(() => ({
    docPath: null,
    workspaceRoot: null,
    settings,
    port: null,
  }));
  // What to make, picked with / or a starting point; null for the model's
  // choice. A message sent with one calls its skill.
  const [kind, setKind] = useState<CreateKind | null>(null);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const composer = useRef<ChatComposerHandle>(null);
  const empty = conversation.history.length === 0 && !conversation.busy;

  const takeRequest = useLatest(() => {
    const request = takeCreateRequest();
    if (!request) return;
    if (!empty && request.text) {
      void conversation.send(NO_DOCUMENT, request.text, [], {
        mode: "create",
        webSearch: true,
      });
      return;
    }
    setKind(KINDS.includes(request.kind) ? request.kind : null);
    if (request.text) composer.current?.restore(request.text);
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
          <button
            type="button"
            className="text-button settings-inline-button"
            disabled={conversation.busy}
            onClick={() => {
              setKind(null);
              conversation.reset();
            }}
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
          defaultWebSearch
          autoTools
          labels={{ ...labels, placeholder: t.createPlaceholder }}
          composerRef={composer}
          kinds={KINDS.map((k) => ({
            key: k,
            label: kindLabel[k],
            pick: () => setKind(k),
          }))}
          kind={
            kind && {
              label: kindLabel[kind],
              clearLabel: t.paperGenreAuto,
              clear: () => setKind(null),
            }
          }
          prepareMessage={(message) => {
            if (empty) slide.mark();
            if (!kind) return message;
            setKind(null);
            return resolveSkillMessage(createMessage(kind, message), skills);
          }}
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
        <ul className="create-studio-examples" aria-label={t.createExamples}>
          {EXAMPLES.map(([k, key]) => (
            <li key={key}>
              <button
                type="button"
                className="create-studio-example"
                onClick={() => {
                  setKind(k);
                  composer.current?.restore(t[key] as string);
                }}
              >
                <span className="create-studio-example-text">
                  {t[key] as string}
                </span>
                <span className="create-studio-example-kind">
                  {kindLabel[k]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
