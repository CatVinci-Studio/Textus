import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../settings/SettingsContext";
import { refineImagePrompt, type PromptTurn } from "../workspace/assist";
import { errorText } from "../../utils/error-text";
import { CloseIcon } from "../../ui/icons";

/**
 * A small conversation for one picture's prompt: the user says what is
 * wrong ("没有孙悟空", "warmer, less crowded"), the text model rewrites the
 * prompt, and the result can be edited by hand before generating again.
 * Nothing is sent to the image service until "Regenerate".
 */
export function PromptRefiner({
  prompt: initial,
  anchor,
  onRegenerate,
  onClose,
}: {
  prompt: string;
  anchor: string;
  onRegenerate: (prompt: string) => void;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const zh = settings.language.startsWith("zh");
  const [prompt, setPrompt] = useState(initial);
  const [history, setHistory] = useState<PromptTurn[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  useEffect(() => {
    list.current?.scrollTo({
      top: list.current.scrollHeight,
      behavior: "smooth",
    });
  }, [history, busy]);
  const send = async () => {
    const instruction = note.trim();
    if (!instruction || busy) return;
    setNote("");
    setError(null);
    setBusy(true);
    const asked: PromptTurn[] = [
      ...history,
      { role: "user", text: instruction },
    ];
    setHistory(asked);
    try {
      const next = await refineImagePrompt(settings, {
        prompt,
        anchor,
        instruction,
        history,
      });
      if (!next)
        throw new Error(zh ? "没有得到新的提示词。" : "No prompt came back.");
      setHistory([...asked, { role: "assistant", text: next }]);
      setPrompt(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const examples = zh
    ? [
        "画面更温暖，黄昏光线",
        "只保留主角，背景简洁",
        "改成水墨画风格",
        "加入更多细节和动作",
      ]
    : [
        "Warmer, dusk light",
        "Only the main figure, simple background",
        "Ink-wash style",
        "More detail and motion",
      ];
  return createPortal(
    <div
      className="prompt-refiner"
      role="dialog"
      aria-label={zh ? "调整图片提示词" : "Adjust the image prompt"}
    >
      <header>
        <strong>{zh ? "调整提示词" : "Adjust prompt"}</strong>
        <button
          type="button"
          className="prompt-refiner-close"
          aria-label={zh ? "关闭" : "Close"}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="prompt-refiner-body" ref={list}>
        <p className="prompt-refiner-anchor" title={anchor}>
          {zh ? "配图段落：" : "Illustrates: "}
          {anchor}
        </p>
        {history.length === 0 && (
          <p className="prompt-refiner-intro">
            {zh
              ? "说说哪里不符合预期，AI 会改写提示词；也可以直接编辑下面的提示词。"
              : "Say what is off and the AI rewrites the prompt - or edit it directly below."}
          </p>
        )}
        {history.map((turn, i) => (
          <div key={i} className={`prompt-refiner-turn is-${turn.role}`}>
            {turn.text}
          </div>
        ))}
        {busy && (
          <div className="prompt-refiner-turn is-assistant is-thinking">
            <span />
            <span />
            <span />
          </div>
        )}
        {error && (
          <p className="prompt-refiner-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <label className="prompt-refiner-prompt">
        <span>{zh ? "将用于生成的提示词" : "Prompt to generate with"}</span>
        <textarea
          value={prompt}
          rows={4}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      {history.length === 0 && (
        <div className="prompt-refiner-examples">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setNote(example)}
            >
              {example}
            </button>
          ))}
        </div>
      )}
      <div className="prompt-refiner-composer">
        <textarea
          ref={input}
          rows={1}
          value={note}
          placeholder={
            zh
              ? "例如：人物太多了，只画孙悟空"
              : "e.g. too many people, only Sun Wukong"
          }
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          disabled={busy || !note.trim()}
          onClick={() => void send()}
        >
          {zh ? "改写" : "Rewrite"}
        </button>
      </div>
      <footer>
        <span>
          {zh
            ? "重新生成会调用图片服务，可能产生费用"
            : "Regenerating calls the image service and may incur charges"}
        </span>
        <button
          type="button"
          className="is-primary"
          disabled={busy || !prompt.trim() || [...prompt].length > 1500}
          onClick={() => onRegenerate(prompt.trim())}
        >
          {zh ? "按此重新生成" : "Regenerate"}
        </button>
      </footer>
    </div>,
    document.body,
  );
}
