import { useEffect, useRef, type RefObject } from "react";
import { DictationRange } from "./dictation-range";
import { useDictationCapture } from "./useDictationCapture";
export function DictationIcon() {
  return (
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
  );
}
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
  const current = useRef(value);
  current.current = value;
  const change = useRef(onChange);
  change.current = onChange;
  const voice = useDictationCapture(active, language, () => {
    const el = inputRef.current;
    const range = new DictationRange(
      current.current,
      el?.selectionStart ?? value.length,
      el?.selectionEnd ?? value.length,
    );
    return {
      apply(text) {
        const next = range.update(current.current, text);
        if (next === null) return false;
        current.current = next;
        change.current(next);
        return true;
      },
    };
  });
  const cancel = voice.cancel;
  useEffect(() => {
    const focus = (event: FocusEvent) => {
      const el = event.target as HTMLElement;
      if (el !== inputRef.current && !el.closest(".inline-dictation")) cancel();
    };
    document.addEventListener("focusin", focus);
    return () => document.removeEventListener("focusin", focus);
  }, [inputRef, cancel]);
  const zh = language.startsWith("zh");
  return (
    <div className="inline-dictation">
      <button
        type="button"
        className={voice.listening ? "dictation-listening" : ""}
        aria-label={
          voice.listening
            ? zh
              ? "停止听写"
              : "Stop dictation"
            : zh
              ? "语音输入"
              : "Voice input"
        }
        title={
          voice.listening
            ? zh
              ? "正在聆听，停顿后自动结束"
              : "Listening; stops after silence"
            : zh
              ? "语音输入"
              : "Voice input"
        }
        disabled={!active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={voice.toggle}
      >
        <DictationIcon />
      </button>
      {voice.error && <span role="alert">{voice.error}</span>}
    </div>
  );
}
