import { useCallback, useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "./useEditorRunner";
import { revealHeading } from "./markdown/heading-jump";
import { onTabJump, takeTabJump, type TabJump } from "./tab-jump";

/** This tab's editor carries out the jump its opener left (tab-jump.ts)
 *  once it is mounted and on screen. */
export function useTabJump(
  run: EditorRunner,
  tabId: string,
  isActive: boolean,
) {
  const runReady = run(() => true) === true;
  const apply = useCallback(
    (jump: TabJump) =>
      run((ctx) => {
        // A heading the document doesn't have leaves it at its top.
        revealHeading(ctx.get(editorViewCtx), jump.anchor);
      }),
    [run],
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
