import { useEffect, useState } from "react";
import { media, type MediaProviderConfig } from "../platform/ipc";
import { useRecording } from "./useRecording";
import { errorText } from "../utils/error-text";
import "./voice.css";

export function VoiceInput({
  active = true,
  language = "en",
  target = "composer",
  onStart,
  onApply,
}: {
  active?: boolean;
  language?: string;
  target?: "composer" | "editor";
  onStart?: () => void;
  onApply: (text: string) => boolean | void;
}) {
  const zh = language.startsWith("zh");
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<MediaProviderConfig | null>(null);
  const [providerError, setProviderError] = useState("");
  const [recognitionLanguage, setRecognitionLanguage] = useState("");
  const [stale, setStale] = useState(false);
  const recording = useRecording(
    active && open,
    recognitionLanguage || null,
    provider?.provider,
  );
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void media.providers().then(
      (providers) => {
        if (!disposed) {
          setProvider(providers?.stt ?? null);
          setProviderError(
            providers?.stt
              ? ""
              : zh
                ? "请先在设置 → Textus AI → 多模态服务配置语音转文字。"
                : "Configure speech to text in Settings > Textus AI > Media providers.",
          );
        }
      },
      (error) => {
        if (!disposed) setProviderError(errorText(error));
      },
    );
    return () => {
      disposed = true;
    };
  }, [open, zh]);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  const pending = [
    "requesting_permission",
    "recording",
    "transcribing",
  ].includes(recording.state);
  return (
    <div className="voice-input">
      <button
        type="button"
        className="voice-launch"
        title={zh ? "语音输入" : "Dictate"}
        aria-label={zh ? "语音输入" : "Dictate"}
        onClick={() => setOpen(!open)}
      >
        🎙
      </button>
      {open && (
        <section
          className="voice-panel"
          aria-label={zh ? "语音输入审阅" : "Dictation review"}
        >
          <strong>{zh ? "语音输入" : "Dictation"}</strong>
          <p>
            {zh
              ? "录音最多 120 秒 / 25 MiB。只有点击转写后才向服务发送音频；结果不会自动发送或写入正文，可能产生费用。"
              : "Up to 120 seconds / 25 MiB. Audio is sent only when you choose to transcribe and may incur charges. Results are reviewed before insertion or sending."}
          </p>
          {provider && (
            <small>
              {provider.endpoint} · {provider.model}
            </small>
          )}
          <label>
            {zh ? "识别语言" : "Recognition language"}
            <select
              disabled={pending}
              value={recognitionLanguage}
              onChange={(e) => setRecognitionLanguage(e.target.value)}
            >
              <option value="">Auto</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          {providerError && <p role="alert">{providerError}</p>}
          {recording.error && <p role="alert">{recording.error}</p>}
          {stale && (
            <p role="alert">
              {zh
                ? "正文或选区已更改，请重新定位后再录音。"
                : "The document or target changed. Choose the target again and record a new segment."}
            </p>
          )}
          <p role="status">
            {recording.state === "recording"
              ? zh
                ? "正在录音…"
                : "Recording…"
              : recording.state === "transcribing"
                ? zh
                  ? "正在转写…"
                  : "Transcribing…"
                : recording.state === "requesting_permission"
                  ? zh
                    ? "正在请求麦克风权限…"
                    : "Requesting microphone permission…"
                  : ""}
          </p>
          {!pending && recording.state !== "review" && (
            <button
              type="button"
              disabled={!provider}
              onClick={() => {
                setStale(false);
                onStart?.();
                void recording.start();
              }}
            >
              {zh ? "开始录音" : "Start recording"}
            </button>
          )}
          {recording.state === "recording" && (
            <button type="button" onClick={recording.stopAndTranscribe}>
              {zh ? "停止并转写" : "Stop and transcribe"}
            </button>
          )}
          {recording.state === "recorded" && (
            <button
              type="button"
              onClick={() => {
                void recording.transcribe();
              }}
            >
              {zh ? "转写此录音" : "Transcribe recording"}
            </button>
          )}
          {recording.state === "review" && (
            <>
              <textarea
                aria-label={zh ? "转写结果" : "Transcription"}
                value={recording.text}
                onChange={(e) => recording.setText(e.target.value)}
              />
              <button
                type="button"
                disabled={!recording.text.trim()}
                onClick={() => {
                  if (onApply(recording.text) === false) {
                    setStale(true);
                    return;
                  }
                  recording.cancel();
                  setOpen(false);
                }}
              >
                {zh
                  ? target === "editor"
                    ? "插入正文"
                    : "填入输入框"
                  : target === "editor"
                    ? "Insert into document"
                    : "Use in composer"}
              </button>
              <button
                type="button"
                onClick={() => {
                  recording.cancel();
                  onStart?.();
                  void recording.start();
                }}
              >
                {zh ? "重新录音" : "Record again"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              recording.cancel();
              setOpen(false);
            }}
          >
            {zh ? "取消" : "Cancel"}
          </button>
        </section>
      )}
    </div>
  );
}
