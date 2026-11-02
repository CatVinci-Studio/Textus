import { Suspense, useEffect, useState } from "react";
import { CreateChat } from "./create-chat-lazy";
import type { Strings } from "../../i18n/strings";
import { useSettings } from "../../prefs/SettingsContext";
import {
  onCreateRequest,
  takeCreateRequest,
} from "../../ai/chat/create-request";
import {
  CREATE_EXAMPLES,
  createKinds,
  createMessage,
  type CreateKind,
} from "./create-studio";

const KINDS = createKinds();

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
  // The first message, once Create has started: the chat takes over.
  const [first, setFirst] = useState<string | null>(null);
  // "Edit with AI", "Fix with AI" before Create starts: filled in for the
  // user to finish. Once it has, the chat takes them.
  const waiting = first === null;
  useEffect(() => {
    if (!waiting) return;
    const take = () => {
      const request = takeCreateRequest();
      if (!request) return;
      setKind(KINDS.includes(request.kind) ? request.kind : KINDS[0]);
      setText(request.text);
    };
    take();
    return onCreateRequest(take);
  }, [waiting]);

  const kindLabel: Record<CreateKind, string> = {
    plugin: t.extensionsTabPlugins,
    theme: t.extensionsTabThemes,
    skill: t.extensionsTabSkills,
  };
  const start = () => {
    if (!text.trim()) return;
    setFirst(createMessage(kind, text));
    setText("");
  };

  if (first !== null)
    return (
      <Suspense fallback={null}>
        <CreateChat
          t={t}
          kindLabel={kindLabel[kind]}
          first={first}
          onNew={() => setFirst(null)}
        />
      </Suspense>
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
