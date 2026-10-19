import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { Settings } from "../settings/SettingsContext";
import { suggestFill } from "../ai/workspace/assist";
import {
  findFillSlots,
  type FillSlotRequest,
} from "../editor/fill-slots/fill-slot-plugin";
import "../editor/fill-slots/fill-slot.css";

/**
 * Filling a blank (【开幕日期】): the text model's suggestions from the
 * document's context - the value the document gives, or candidates - one
 * click away, or your own words. The blank is replaced in one step, so
 * Undo brings it back.
 */
export function FillSlotCard({
  request,
  run,
  settings,
  onClose,
}: {
  request: FillSlotRequest;
  run: EditorRunner;
  settings: Settings;
  onClose: () => void;
}) {
  const zh = settings.language.startsWith("zh");
  const [options, setOptions] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [own, setOwn] = useState("");
  const card = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let live = true;
    const context = run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc } = view.state;
      const at = Math.min(request.from, doc.content.size);
      return {
        markdown: ctx.get(serializerCtx)(doc),
        paragraph: doc.resolve(at).parent.textContent,
      };
    });
    if (!context) return;
    void suggestFill(
      settings,
      context.markdown,
      request.label,
      context.paragraph,
    )
      .then((found) => live && setOptions(found))
      .catch(() => {
        if (!live) return;
        setFailed(true);
        setOptions([]);
      });
    return () => {
      live = false;
    };
    // Once per opened blank.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    const outside = (event: PointerEvent) => {
      if (!card.current?.contains(event.target as Node)) close.current();
    };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, []);

  // Under the blank, kept inside the window.
  const [place, setPlace] = useState({ left: request.rect.left, top: 0 });
  useLayoutEffect(() => {
    const width = card.current?.offsetWidth ?? 300;
    const height = card.current?.offsetHeight ?? 180;
    const left = Math.max(
      8,
      Math.min(request.rect.left, window.innerWidth - width - 8),
    );
    const below = request.rect.bottom + 6;
    const top =
      below + height > window.innerHeight - 8
        ? Math.max(8, request.rect.top - height - 6)
        : below;
    setPlace({ left, top });
  }, [request, options]);

  const fill = (value: string) => {
    const text = value.trim();
    if (!text) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc } = view.state;
      const blank = `【${request.label}】`;
      // The document may have moved since the click: find the blank again.
      const slot =
        doc.textBetween(request.from, request.to) === blank
          ? request
          : findFillSlots(doc).find((s) => s.label === request.label);
      if (!slot) return;
      view.dispatch(view.state.tr.insertText(text, slot.from, slot.to));
      view.focus();
    });
    onClose();
  };

  return createPortal(
    <div
      ref={card}
      className="fill-slot-card"
      role="dialog"
      aria-label={
        zh ? `填写「${request.label}」` : `Fill in "${request.label}"`
      }
      style={{ left: place.left, top: place.top }}
      // Its fields are small: no floating microphone over them.
      data-no-dictation
    >
      <div className="fill-slot-card-head">
        <span className="fill-slot-card-label">【{request.label}】</span>
        <span>{zh ? "AI 建议 · 点击填入" : "Suggestions · click to fill"}</span>
      </div>
      <div className="fill-slot-card-options">
        {options === null &&
          [0, 1, 2].map((i) => (
            <span key={i} className="fill-slot-card-skeleton" />
          ))}
        {options?.map((option, i) => (
          <button
            key={option}
            type="button"
            className={i === 0 ? "is-primary" : undefined}
            style={{ "--i": i } as React.CSSProperties}
            onClick={() => fill(option)}
          >
            {option}
          </button>
        ))}
        {options?.length === 0 && (
          <p className="fill-slot-card-none">
            {failed
              ? zh
                ? "没能得到建议，请直接填写。"
                : "No suggestions came back - type it in."
              : zh
                ? "文档里没有依据，请直接填写。"
                : "Nothing in the document to go on - type it in."}
          </p>
        )}
      </div>
      <form
        className="fill-slot-card-own"
        onSubmit={(event) => {
          event.preventDefault();
          fill(own);
        }}
      >
        <input
          autoFocus
          value={own}
          placeholder={zh ? "自己填写…" : "Type your own…"}
          onChange={(event) => setOwn(event.target.value)}
        />
        <button type="submit" disabled={!own.trim()}>
          {zh ? "填入" : "Fill"}
        </button>
      </form>
      <p className="fill-slot-card-note">
        {zh
          ? "建议来自 AI，事实性信息请核实。"
          : "Suggestions come from the AI - check facts."}
      </p>
    </div>,
    document.body,
  );
}
