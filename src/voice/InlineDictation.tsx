import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { dictation } from "../platform/ipc";
import { useRecording } from "./useRecording";
import { DictationRange } from "./dictation-range";
import { errorText } from "../utils/error-text";
export function InlineDictation({
  active,
  language,
  value,
  inputRef,
  onChange,
}: {
  active: boolean;
  language: string;
  value: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (text: string) => void;
}) {
  const zh = language.startsWith("zh");
  const [provider, setProvider] = useState<"system" | "minimax">("system");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(value);
  current.current = value;
  const range = useRef<DictationRange | null>(null);
  const generation = useRef(0);
  const token = useRef<number | null>(null);
  const recording = useRecording(active, language, "minimax", true);
  const recordingCancel = useRef(recording.cancel);
  recordingCancel.current = recording.cancel;
  const change = useRef(onChange);
  change.current = onChange;
  const cancel = useCallback(() => {
    generation.current++;
    range.current = null;
    setListening(false);
    if (token.current !== null)
      void dictation.stop(token.current).catch(() => {});
    token.current = null;
    recordingCancel.current();
  }, []);
  const apply = useCallback(
    (text: string) => {
      const next = range.current?.update(current.current, text);
      if (next == null) {
        cancel();
        return;
      }
      current.current = next;
      change.current(next);
    },
    [cancel],
  );
  useEffect(() => {
    if (!active) cancel();
    return cancel;
  }, [active, cancel]); // session/input owner lifecycle
  useEffect(() => {
    const stop = () => cancel();
    window.addEventListener("blur", stop);
    return () => window.removeEventListener("blur", stop);
  }, [cancel]);
  useEffect(() => {
    if (recording.state === "review" && range.current) {
      apply(recording.text);
      setListening(false);
      range.current = null;
      recordingCancel.current();
    }
    if (
      recording.state === "error" ||
      (provider === "minimax" && recording.state === "idle")
    ) {
      setListening(false);
      range.current = null;
    }
  }, [recording.state, recording.text, apply, provider]);
  useEffect(() => {
    const focus = (event: FocusEvent) => {
      const el = event.target as HTMLElement;
      if (el !== inputRef.current && !el.closest(".inline-dictation")) cancel();
    };
    document.addEventListener("focusin", focus);
    return () => document.removeEventListener("focusin", focus);
  }, [cancel, inputRef]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [cancel]);
  async function start() {
    setError(null);
    const el = inputRef.current;
    range.current = new DictationRange(
      current.current,
      el?.selectionStart ?? value.length,
      el?.selectionEnd ?? value.length,
    );
    const run = ++generation.current;
    setListening(true);
    if (provider === "minimax") {
      await recording.start();
      return;
    }
    try {
      const id = await dictation.start(zh ? "zh-CN" : language, (event) => {
        if (run !== generation.current) return;
        if (event.error) {
          setError(event.text);
          cancel();
          return;
        }
        apply(event.text);
        if (event.done) {
          setListening(false);
          range.current = null;
          token.current = null;
        }
      });
      if (run !== generation.current) void dictation.stop(id);
      else token.current = id;
    } catch (err) {
      if (run === generation.current) {
        setError(errorText(err));
        cancel();
      }
    }
  }
  return (
    <div className="inline-dictation">
      <button
        type="button"
        className={listening ? "dictation-listening" : ""}
        aria-label={
          listening
            ? zh
              ? "停止听写"
              : "Stop dictation"
            : zh
              ? "语音输入"
              : "Voice input"
        }
        title={
          listening
            ? zh
              ? "正在聆听，停顿后自动结束"
              : "Listening; stops after silence"
            : zh
              ? "语音输入"
              : "Voice input"
        }
        disabled={!active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (listening) {
            if (provider === "minimax") recording.stopAndTranscribe();
            else cancel();
          } else void start();
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={zh ? "切换听写服务" : "Switch dictation service"}
        title={
          provider === "system"
            ? zh
              ? "系统实时听写；点击切换 MiniMax"
              : "System live dictation; click for MiniMax"
            : zh
              ? "MiniMax 停顿后转写；点击切换系统"
              : "MiniMax transcribes after silence; click for System"
        }
        disabled={listening}
        onClick={() => {
          setProvider(provider === "system" ? "minimax" : "system");
          setError(null);
        }}
      >
        {provider === "system" ? "⌄" : "M"}
      </button>
      {(error || recording.error) && (
        <span role="alert">{error || recording.error}</span>
      )}
    </div>
  );
}
