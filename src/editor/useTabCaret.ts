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
 * Tells where this tab's caret is as the tab leaves the screen - switched
 * away from, closed, the window losing focus - and whenever it is asked
 * (tab-caret.ts). `markdown` is the tab's text, which the offset counts
 * into. Reading it writes out the document up to the caret (a large
 * document gives its position instead, see CaretPlace), so the answer is
 * kept until the document or the caret moves: a tab clicked away from and
 * back costs nothing the second time.
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
      // Switched away from, or closed: the editor is still there to ask
      // (it is torn down after this component's effects).
      reportTabCaret(tabId, read());
    };
  }, [isActive, runReady, tabId, read]);
}
