import { useCallback, useEffect, useRef } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Selection } from "@milkdown/kit/prose/state";
import type { EditorRunner } from "./useEditorRunner";
import { useLatest } from "../utils/hooks/useLatest";
import { isLargeDoc } from "./large-doc";
import { flushDomSelection, readEditorCaret } from "./modes/mode-switch";
import { registerTabCaret, reportTabCaret, type CaretPlace } from "./tab-caret";

/**
 * Reports this tab's caret as the tab leaves the screen, and whenever asked.
 * `markdown` is the text the offset counts into. Reading it serializes up to
 * the caret, so the answer is kept until the document or caret moves.
 */
export function useTabCaret(
  run: EditorRunner,
  tabId: string,
  isActive: boolean,
  markdown: () => string,
) {
  const last = useRef<{
    doc: ProseNode;
    selection: Selection;
    caret: CaretPlace;
  } | null>(null);
  const markdownRef = useLatest(markdown);
  const read = useCallback(
    () =>
      run((ctx): CaretPlace => {
        const view = ctx.get(editorViewCtx);
        flushDomSelection(view);
        const { doc, selection } = view.state;
        const seen = last.current;
        if (seen?.doc === doc && seen.selection.eq(selection))
          return seen.caret;
        const caret = isLargeDoc(doc)
          ? { pos: selection.head }
          : { offset: readEditorCaret(ctx, markdownRef.current()).offset };
        last.current = { doc, selection, caret };
        return caret;
      }) ?? null,
    [run, markdownRef],
  );
  useEffect(() => registerTabCaret(tabId, read), [tabId, read]);
  const runReady = run(() => true) === true;
  useEffect(() => {
    if (!isActive || !runReady) return;
    const onBlur = () => reportTabCaret(tabId, read());
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      // Switched away from or closed: the editor is still there to ask, torn down
      // after this component's effects.
      reportTabCaret(tabId, read());
    };
  }, [isActive, runReady, tabId, read]);
}
