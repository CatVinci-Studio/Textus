import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../settings/SettingsContext";
import {
  condenseImagePrompt,
  IMAGE_PROMPT_LIMIT,
  promptLength,
  refineImagePrompt,
  suggestPromptVariants,
  type PromptTurn,
  type Suggestion,
} from "../workspace/assist";
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
  approve = false,
  inline = false,
  onCancel,
}: {
  prompt: string;
  anchor: string;
  /** Generates with the given prompt (the footer, or a suggestion chip). */
  onRegenerate: (prompt: string) => void;
  /** Inline: the prompt as edited so far, kept on the card. */
  onClose: (prompt?: string) => void;
  /** First generation of a drafted prompt rather than a redo. */
  approve?: boolean;
  /** Lives inside the document's image card instead of a floating window. */
  inline?: boolean;
  /** Inline only: withdraw this illustration altogether. */
  onCancel?: () => void;
}) {
  const { settings } = useSettings();
  const zh = settings.language.startsWith("zh");
  const [prompt, setPrompt] = useState(initial);
  const [history, setHistory] = useState<PromptTurn[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  // Three directions the model proposes; one click generates that version.
  const [variants, setVariants] = useState<Suggestion[] | null>(null);
  useEffect(() => {
    let live = true;
    void suggestPromptVariants(settings, initial, anchor)
      .then((items) => live && setVariants(items))
      .catch(() => live && setVariants([]));
    return () => {
      live = false;
    };
    // Once per opened prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, anchor]);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), []);
  // Escape closes; read through a ref so a new onClose each render neither
  // re-binds nor (as it used to) pulls focus back to the note box.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    list.current?.scrollTo({
      top: list.current.scrollHeight,
      behavior: "smooth",
    });
  }, [history, busy]);
  const length = promptLength(prompt);
  const tooLong = length > IMAGE_PROMPT_LIMIT;
  const condense = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setPrompt(await condenseImagePrompt(settings, prompt));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
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
  const content = (
    <div
      className={`prompt-refiner${inline ? " is-inline" : ""}`}
      // Its fields are small and its footer sits where the floating
      // microphone would: no dictation button over them.
      data-no-dictation
      role={inline ? "group" : "dialog"}
      aria-label={zh ? "调整图片提示词" : "Adjust the image prompt"}
    >
      {!inline && (
        <header>
          <strong>
            {approve
              ? zh
                ? "确认配图提示词"
                : "Approve the image prompt"
              : zh
                ? "调整提示词"
                : "Adjust prompt"}
          </strong>
          <button
            type="button"
            className="prompt-refiner-close"
            aria-label={zh ? "关闭" : "Close"}
            onClick={() => onClose()}
          >
            <CloseIcon />
          </button>
        </header>
      )}
      <div className="prompt-refiner-body" ref={list}>
        {!inline && (
          <p className="prompt-refiner-anchor" title={anchor}>
            {zh ? "配图段落：" : "Illustrates: "}
            {anchor}
          </p>
        )}
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
        <span className="prompt-refiner-prompt-head">
          {zh ? "将用于生成的提示词" : "Prompt to generate with"}
          <span className={`prompt-refiner-count${tooLong ? " is-over" : ""}`}>
            {length} / {IMAGE_PROMPT_LIMIT}
          </span>
        </span>
        <textarea
          value={prompt}
          rows={4}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      {tooLong && (
        <div className="prompt-refiner-limit" role="alert">
          <span>
            {zh
              ? `提示词超过图片服务的 ${IMAGE_PROMPT_LIMIT} 字上限，需要先精简才能生成。`
              : `The prompt is over the image service's ${IMAGE_PROMPT_LIMIT}-character limit; condense it to generate.`}
          </span>
          <button type="button" disabled={busy} onClick={() => void condense()}>
            {zh ? "一键精简" : "Condense"}
          </button>
        </div>
      )}
      <div className="prompt-refiner-variants">
        <span>
          {zh ? "AI 建议 · 点击直接生成" : "AI suggestions · click to generate"}
        </span>
        <div>
          {variants === null &&
            [0, 1, 2].map((i) => (
              <span key={i} className="prompt-refiner-variant-skeleton" />
            ))}
          {variants?.map((variant, i) => (
            <button
              key={variant.label}
              type="button"
              style={{ "--i": i } as React.CSSProperties}
              title={variant.prompt}
              disabled={busy}
              onClick={() => onRegenerate(variant.prompt)}
            >
              ✦ {variant.label}
            </button>
          ))}
          {variants?.length === 0 &&
            examples.map((example) => (
              <button
                key={example}
                type="button"
                className="is-quiet"
                onClick={() => setNote(example)}
              >
                {example}
              </button>
            ))}
        </div>
      </div>
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
            ? "生成会调用图片服务，可能产生费用"
            : "Generating calls the image service and may incur charges"}
        </span>
        {inline && (
          <>
            <button
              type="button"
              className="is-quiet"
              onClick={() => onClose(prompt.trim() || undefined)}
            >
              {zh ? "收起" : "Done"}
            </button>
            {onCancel && (
              <button type="button" className="is-quiet" onClick={onCancel}>
                {zh ? "取消配图" : "Discard"}
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="is-primary"
          disabled={busy || !prompt.trim() || tooLong}
          title={
            tooLong
              ? zh
                ? "提示词过长，请先精简"
                : "The prompt is too long; condense it first"
              : undefined
          }
          onClick={() => onRegenerate(prompt.trim())}
        >
          {approve
            ? zh
              ? "生成图片"
              : "Generate"
            : zh
              ? "按此重新生成"
              : "Regenerate"}
        </button>
      </footer>
    </div>
  );
  // Inline: rendered by the caller into the image card in the document.
  return inline ? content : createPortal(content, document.body);
}
