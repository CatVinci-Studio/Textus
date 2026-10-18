import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DictationIcon } from "./InlineDictation";
import { DictationRange } from "./dictation-range";
import {
  captureDictationTarget,
  hasDictationTarget,
  type DictationTargetSession,
} from "./dictation-target";
import { useDictationCapture } from "./useDictationCapture";
import "./global-dictation.css";

export function captureTextInput(
  element: HTMLInputElement | HTMLTextAreaElement,
): DictationTargetSession {
  const range = new DictationRange(
    element.value,
    element.selectionStart ?? element.value.length,
    element.selectionEnd ?? element.value.length,
  );
  let finished = false;
  return {
    apply(text) {
      if (finished || !element.isConnected) return false;
      const next = range.update(element.value, text);
      if (next === null) return false;
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
        element,
        next,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    finish() {
      finished = true;
    },
  };
}
function eligible(element: HTMLElement) {
  if (
    element.closest(
      ".inline-chat-input, .inline-dictation, .global-dictation, [data-no-dictation]",
    )
  )
    return false;
  if (hasDictationTarget(element)) return true;
  if (element instanceof HTMLTextAreaElement)
    return !element.disabled && !element.readOnly;
  return (
    element instanceof HTMLInputElement &&
    ["text", "search"].includes(element.type) &&
    !element.disabled &&
    !element.readOnly
  );
}
export function GlobalDictation({ language }: { language: string }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const voice = useDictationCapture(!!target, language, () =>
    target
      ? (captureDictationTarget(target) ??
        (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
          ? captureTextInput(target)
          : null))
      : null,
  );
  const cancel = voice.cancel;
  useEffect(() => {
    const focus = (event: FocusEvent) => {
      const element = event.target as HTMLElement;
      if (element.closest(".global-dictation")) return;
      cancel();
      setTarget(eligible(element) ? element : null);
    };
    document.addEventListener("focusin", focus);
    return () => document.removeEventListener("focusin", focus);
  }, [cancel]);
  useEffect(() => {
    if (!target) return;
    const update = () => {
      if (!target.isConnected || !target.getClientRects().length) {
        cancel();
        setTarget(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setPosition({
        top: Math.min(window.innerHeight - 44, Math.max(8, rect.bottom - 38)),
        left: Math.min(window.innerWidth - 44, Math.max(8, rect.right - 38)),
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [target, cancel]);
  if (!target) return null;
  const zh = language.startsWith("zh");
  return createPortal(
    <div className="global-dictation inline-dictation" style={position}>
      <button
        type="button"
        className={voice.listening ? "dictation-listening" : ""}
        onMouseDown={(event) => event.preventDefault()}
        onClick={voice.toggle}
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
          zh ? "语音输入 · 停顿后自动结束" : "Dictate · stops after silence"
        }
      >
        <DictationIcon />
      </button>
      {voice.error && <span role="alert">{voice.error}</span>}
    </div>,
    document.body,
  );
}
