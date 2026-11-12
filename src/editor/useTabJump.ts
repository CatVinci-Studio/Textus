import { useCallback, useEffect, useRef } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "./useEditorRunner";
import { useLatest } from "../utils/hooks/useLatest";
import {
  revealHeading,
  revealNthHeading,
  selectNthSection,
} from "./markdown/heading-jump";
import { applyEditorCaret, placeEditorCaret } from "./modes/mode-switch";
import { onTabJump, takeTabJump, type TabJump } from "./tab-jump";
import type { Ctx } from "@milkdown/kit/ctx";
import type { DocumentPlace } from "../plugins/app-bridge";

/** This tab's editor carries out the jump its opener left once mounted and
 *  on screen. `initialValue` is the markdown a caret offset counts into. */
export function useTabJump(
  run: EditorRunner,
  tabId: string,
  isActive: boolean,
  initialValue: string,
  typewriter: boolean,
  /** Goes to a place a plugin opened the document at. */
  revealPlace: (ctx: Ctx, place: DocumentPlace) => void,
) {
  const runReady = run(() => true) === true;
  const mountedValue = useRef(initialValue);
  const typewriterRef = useLatest(typewriter);
  const apply = useCallback(
    (jump: TabJump) =>
      run((ctx) => {
        // A heading the document doesn't have leaves it at its top.
        if (jump.kind === "heading")
          revealHeading(ctx.get(editorViewCtx), jump.anchor);
        else if (jump.kind === "outline")
          (jump.select ? selectNthSection : revealNthHeading)(
            ctx.get(editorViewCtx),
            jump.index,
          );
        // A line alone is counted in the text as it was opened, not in
        // the editor's own writing of it (blank lines, lists, front matter).
        else if (jump.kind === "place" && onlyLine(jump.place) !== null)
          applyEditorCaret(
            ctx,
            mountedValue.current,
            {
              offset: lineOffset(mountedValue.current, onlyLine(jump.place)!),
              viewportY: null,
            },
            typewriterRef.current,
          );
        else if (jump.kind === "place") revealPlace(ctx, jump.place);
        // An offset past the end lands at the end. In Typewriter Mode the caret's
        // line goes to the middle.
        else if ("pos" in jump.at)
          placeEditorCaret(
            ctx.get(editorViewCtx),
            jump.at.pos,
            null,
            typewriterRef.current,
          );
        else
          applyEditorCaret(
            ctx,
            mountedValue.current,
            { offset: jump.at.offset, viewportY: null },
            typewriterRef.current,
          );
      }),
    [run, typewriterRef, revealPlace],
  );
  useEffect(() => {
    if (!isActive || !runReady) return;
    const take = () => {
      const jump = takeTabJump(tabId);
      // After layout: a tab just shown or mounted has no coordinates before then.
      if (jump) requestAnimationFrame(() => apply(jump));
    };
    take();
    return onTabJump((id) => {
      if (id === tabId) take();
    });
  }, [isActive, runReady, tabId, apply]);
}

/** The 0-based line `place` asks for when that is all it says. */
function onlyLine(place: DocumentPlace): number | null {
  return typeof place.line === "number" &&
    !place.block &&
    !place.text &&
    !place.heading
    ? place.line
    : null;
}

/** Where 0-based line `line` starts in `text`; its end past the last. */
export function lineOffset(text: string, line: number): number {
  let at = 0;
  for (let i = 0; i < line; i++) {
    const next = text.indexOf("\n", at);
    if (next < 0) return text.length;
    at = next + 1;
  }
  return at;
}
