import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorRunner } from "../editor/useEditorRunner";
import { media } from "../platform/ipc";
import { useSpeechPlayback } from "../voice/useSpeechPlayback";
import { errorText } from "../utils/error-text";
import { useReadAloudTarget } from "./useReadAloudTarget";
import "./write-playback.css";

/** Capture the requested text before Settings is read, preserving the selection. */
export function useWritePlayback(run: EditorRunner, active: boolean) {
  const target = useReadAloudTarget(run);
  const player = useSpeechPlayback(active, target.highlight, target.clear);
  const { stop: stopAudio, setRate, start: startAudio } = player;
  const [preparing, setPreparing] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    setPreparing(false);
    setConfigError(null);
    stopAudio();
  }, [stopAudio]);
  useEffect(() => {
    const changed = () => stop();
    window.addEventListener("textus-media-settings-change", changed);
    return () =>
      window.removeEventListener("textus-media-settings-change", changed);
  }, [stop]);
  useEffect(() => {
    if (!active) stop();
    return stop;
  }, [active, stop]);
  const start = useCallback(
    async (range: "document" | "selection" = "document") => {
      if (!active) return;
      stop();
      const token = generation.current;
      const text = target.getText(range);
      if (!text.trim()) return;
      setPreparing(true);
      try {
        const config = (await media.providers()).tts;
        if (token !== generation.current) return;
        if (!config)
          throw new Error(
            "Configure text to speech in Settings → Textus AI → Media providers.",
          );
        setRate(config.playbackRate ?? 1);
        startAudio(text, config.voice ?? "");
      } catch (error) {
        if (token === generation.current) setConfigError(errorText(error));
      } finally {
        if (token === generation.current) setPreparing(false);
      }
    },
    [active, stop, target, setRate, startAudio],
  );
  return {
    ...player,
    start,
    stop,
    preparing,
    error: configError || player.error,
  };
}

type Reader = ReturnType<typeof useWritePlayback>;
function PlaybackIcon({
  kind,
}: {
  kind: "speaker" | "pause" | "play" | "stop";
}) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "speaker" ? (
        <>
          <path d="M11 4 6 8H3v8h3l5 4V4Z" />
          <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
        </>
      ) : kind === "pause" ? (
        <>
          <path d="M8 5v14M16 5v14" />
        </>
      ) : kind === "play" ? (
        <path d="m8 5 11 7-11 7V5Z" />
      ) : (
        <rect x="6" y="6" width="12" height="12" rx="1" />
      )}
    </svg>
  );
}

export function WritePlayback({
  reader,
  language,
}: {
  reader: Reader;
  language: string;
}) {
  const zh = language.startsWith("zh");
  const busy =
    reader.preparing || ["loading", "playing", "paused"].includes(reader.state);
  const paused = reader.state === "paused";
  const label = paused
    ? zh
      ? "继续朗读"
      : "Resume reading"
    : busy
      ? zh
        ? "暂停朗读"
        : "Pause reading"
      : zh
        ? "朗读全文"
        : "Read document aloud";
  return (
    <div className="write-playback">
      <div
        className="write-playback-pill"
        role="group"
        aria-label={zh ? "文稿朗读" : "Document reading"}
      >
        <button
          type="button"
          title={label}
          aria-label={label}
          disabled={reader.preparing}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (paused) void reader.resume();
            else if (busy) reader.pause();
            else void reader.start("document");
          }}
        >
          <PlaybackIcon kind={paused ? "play" : busy ? "pause" : "speaker"} />
          <span>
            {busy ? `${reader.position}/${reader.total}` : zh ? "朗读" : "Read"}
          </span>
        </button>
        {busy && (
          <button
            type="button"
            title={zh ? "停止朗读" : "Stop reading"}
            aria-label={zh ? "停止朗读" : "Stop reading"}
            onClick={reader.stop}
          >
            <PlaybackIcon kind="stop" />
          </button>
        )}
      </div>
      {reader.error && (
        <p className="write-playback-error" role="alert">
          {reader.error}
          <button
            type="button"
            aria-label={zh ? "关闭" : "Dismiss"}
            onClick={reader.stop}
          >
            ×
          </button>
        </p>
      )}
    </div>
  );
}
