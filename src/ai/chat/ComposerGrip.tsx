import { useLayoutEffect, useState, type RefObject } from "react";
import { ResizeHandle } from "../../engine/controls/ResizeHandle";
import { currentStrings } from "../../i18n/current";
import { getUiState, setUiState } from "../../storage/ui-state";
import { fitComposer } from "./useComposerState";

/** Below this the box is as it was: grown by its text alone. */
const LEAST = 48;

/**
 * The composer's top edge, dragged to make its box as tall as wanted: the
 * height is kept for every composer, and the text still grows past it.
 * Double-clicked, the box grows by its text alone again.
 */
export function ComposerGrip({
  input,
}: {
  input: RefObject<HTMLTextAreaElement | null>;
}) {
  const [px, setPx] = useState(() => Number(getUiState("composerPx")) || 0);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    if (px) el.style.setProperty("--composer-px", `${px}px`);
    else el.style.removeProperty("--composer-px");
    fitComposer(el);
  }, [input, px]);
  const most = Math.round(window.innerHeight * 0.6);
  const resize = (size: number, done: boolean) => {
    const next = size < LEAST ? 0 : Math.min(Math.round(size), most);
    setPx(next);
    if (done) setUiState("composerPx", next);
  };
  return (
    <ResizeHandle
      className="composer-grip"
      edge="top"
      size={px || input.current?.offsetHeight || LEAST}
      min={LEAST}
      max={most}
      onResize={resize}
      onReset={() => resize(0, true)}
      label={currentStrings().composerResize}
    />
  );
}
