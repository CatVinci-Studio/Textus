import { useCallback, useEffect, useRef } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "./useEditorRunner";
import { useLatest } from "../utils/hooks/useLatest";
import { revealHeading } from "./markdown/heading-jump";
import { applyEditorCaret, placeEditorCaret } from "./modes/mode-switch";
import { onTabJump, takeTabJump, type TabJump } from "./tab-jump";
import type { Ctx } from "@milkdown/kit/ctx";
import type { DocumentPlace } from "../plugins/app-bridge";

/** This tab's editor carries out the jump its opener left (tab-jump.ts)
 *  once it is mounted and on screen. `initialValue` is the markdown it
 *  mounted with, which a caret offset counts into. */
export function useTabJump(
  run: EditorRunner,
  tabId: string,
  isActive: boolean,
  initialValue: string,
  typewriter: boolean,
  /** Goes to a place a plugin opened the document at (document-view's
   *  plugin-edits.ts, a layer above this one). */
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
        else if (jump.kind === "place") revealPlace(ctx, jump.place);
        // An offset past the end (a shorter file) lands at the end. In
        // Typewriter Mode the caret's line goes to the middle, where the
        // next key would put it anyway.
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
      // After layout: a tab just shown or just mounted has no coordinates
      // to scroll by before then.
      if (jump) requestAnimationFrame(() => apply(jump));
    };
    take();
    return onTabJump((id) => {
      if (id === tabId) take();
    });
  }, [isActive, runReady, tabId, apply]);
}
