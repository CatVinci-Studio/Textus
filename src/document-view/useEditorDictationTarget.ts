import { useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { closeHistory } from "@milkdown/kit/prose/history";
import { documentRevisionKey } from "../ai/workspace/revision-plugin";
import type { EditorRunner } from "../editor/useEditorRunner";
import { registerDictationTarget } from "../voice/dictation-target";

/** Each transcript replaces its previous partial result, preserving surrounding text. */
export function captureEditorDictation(run: EditorRunner) {
  const saved = run((ctx) => {
    const state = ctx.get(editorViewCtx).state;
    return {
      from: state.selection.from,
      to: state.selection.to,
      selectionFrom: state.selection.from,
      selectionTo: state.selection.to,
      revision: documentRevisionKey.getState(state) ?? 0,
    };
  });
  if (!saved) return null;
  let finished = false;
  let first = true;
  return {
    apply(text: string): boolean {
      if (finished) return false;
      return (
        run((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (
            (documentRevisionKey.getState(view.state) ?? 0) !==
              saved.revision ||
            view.state.selection.from !== saved.selectionFrom ||
            view.state.selection.to !== saved.selectionTo
          ) {
            finished = true;
            return false;
          }
          let tr = view.state.tr.insertText(text, saved.from, saved.to);
          if (first) tr = closeHistory(tr);
          view.dispatch(tr);
          first = false;
          saved.to = saved.from + text.length;
          saved.selectionFrom = view.state.selection.from;
          saved.selectionTo = view.state.selection.to;
          saved.revision = documentRevisionKey.getState(view.state) ?? 0;
          return true;
        }) ?? false
      );
    },
    finish() {
      finished = true;
    },
  };
}

export function useEditorDictationTarget(run: EditorRunner, active: boolean) {
  useEffect(() => {
    if (!active) return;
    return run((ctx) =>
      registerDictationTarget(ctx.get(editorViewCtx).dom, () =>
        captureEditorDictation(run),
      ),
    );
  }, [run, active]);
}
