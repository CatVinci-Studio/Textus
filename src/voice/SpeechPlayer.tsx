import { createContext, useContext, useState, type ReactNode } from "react";
import { media, type MediaProviderConfig } from "../platform/ipc";
import { useSpeechPlayback } from "./useSpeechPlayback";
import type { SpeechChunk } from "./speech-chunks";
import { renderMarkdownHtml } from "../editor/markdown/render-html";
import { errorText } from "../utils/error-text";
import "./speech.css";

const Scope = createContext({ active: true, language: "en" });
export function SpeechScope({
  active,
  language,
  children,
}: {
  active: boolean;
  language: string;
  children: ReactNode;
}) {
  return (
    <Scope.Provider value={{ active, language }}>{children}</Scope.Provider>
  );
}

export function SpeechPlayer({
  text = "",
  getText,
  active: activeOverride,
  language: languageOverride,
  markdown = false,
  onChunk,
  onStop,
  rangeControls,
}: {
  text?: string;
  getText?: () => string;
  active?: boolean;
  language?: string;
  markdown?: boolean;
  onChunk?: (chunk: SpeechChunk) => boolean | void;
  onStop?: () => void;
  rangeControls?: ReactNode;
}) {
  const scope = useContext(Scope);
  const active = activeOverride ?? scope.active;
  const language = languageOverride ?? scope.language;
  const zh = language.startsWith("zh");
  const [provider, setProvider] = useState<MediaProviderConfig | null>(null);
  const [voice, setVoice] = useState("");
  const [preview, setPreview] = useState("");
  const [configError, setConfigError] = useState("");
  const [open, setOpen] = useState(false);
  const player = useSpeechPlayback(active && open, onChunk, onStop);
  const sourceText = () => {
    if (getText) return getText();
    if (!markdown) return text;
    const document = new DOMParser().parseFromString(
      renderMarkdownHtml(text),
      "text/html",
    );
    return Array.from(document.body.childNodes)
      .map((node) => node.textContent ?? "")
      .join("\n\n");
  };
  const playing = ["loading", "playing", "paused"].includes(player.state);
  return (
    <details
      className="speech-player"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) {
          setPreview(sourceText());
          void media.providers().then(
            (providers) => {
              setProvider(providers?.tts ?? null);
              setVoice(providers?.tts?.voice ?? "");
              setConfigError(
                providers?.tts
                  ? ""
                  : zh
                    ? "请先配置文字朗读服务。"
                    : "Configure text to speech in Settings > Textus AI > Media providers.",
              );
            },
            (error) => setConfigError(errorText(error)),
          );
        }
      }}
    >
      <summary>{zh ? "朗读" : "Read aloud"}</summary>
      <div className="speech-controls">
        {rangeControls}
        <p>
          {zh
            ? "AI 合成语音。仅将所选范围的文字分段发送到以下服务，可能产生费用；朗读不会修改或保存正文。"
            : "AI-generated speech. Only text in the selected range is sent in bounded chunks to this service and may incur charges. Reading does not edit or save the document."}
        </p>
        {provider && (
          <small>
            {provider.endpoint} · {provider.model}
          </small>
        )}
        <p className="speech-text-preview">
          {preview.slice(0, 220)}
          {preview.length > 220 ? "…" : ""}
        </p>
        <label>
          {zh ? "音色" : "Voice"}
          <input
            disabled={playing}
            value={voice}
            onChange={(event) => setVoice(event.target.value)}
          />
        </label>
        <label>
          {zh ? "播放速度" : "Playback speed"}
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={player.rate}
            onChange={(event) => player.setRate(Number(event.target.value))}
          />
          <span>{player.rate.toFixed(1)}×</span>
        </label>
        {!playing && (
          <button
            type="button"
            disabled={!provider || !voice.trim() || !active}
            onClick={() => {
              const source = sourceText();
              setPreview(source);
              player.start(source, voice);
            }}
          >
            {zh ? "播放" : "Play"}
          </button>
        )}
        {(player.state === "playing" || player.state === "loading") && (
          <button type="button" onClick={player.pause}>
            {zh ? "暂停" : "Pause"}
          </button>
        )}
        {player.state === "paused" && (
          <button
            type="button"
            onClick={() => {
              void player.resume();
            }}
          >
            {zh ? "继续" : "Resume"}
          </button>
        )}
        {playing && (
          <button type="button" onClick={player.stop}>
            {zh ? "停止朗读" : "Stop reading"}
          </button>
        )}
        {player.state === "error" && (
          <button type="button" onClick={player.retry}>
            {zh ? "重试当前段落" : "Retry paragraph"}
          </button>
        )}
        {playing && (
          <span role="status">
            {player.position}/{player.total} · {player.state}
          </span>
        )}
        {(configError || player.error) && (
          <p role="alert">{configError || player.error}</p>
        )}
      </div>
    </details>
  );
}
