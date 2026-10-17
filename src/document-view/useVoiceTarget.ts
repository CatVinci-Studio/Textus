import { useCallback, useRef } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { closeHistory } from "@milkdown/kit/prose/history";
import type { EditorRunner } from "../editor/useEditorRunner";
import { documentRevisionKey } from "../ai/workspace/revision-plugin";
import { applyEditRange } from "../ai/revision/apply-edit";

export function useVoiceTarget(run: EditorRunner) {
  const target = useRef<{
    revision: number;
    from: number;
    to: number;
    expected: string;
  } | null>(null);
  const capture = useCallback(() => {
    target.current =
      run((ctx) => {
        const state = ctx.get(editorViewCtx).state;
        const { from, to } = state.selection;
        return {
          revision: documentRevisionKey.getState(state) ?? 0,
          from,
          to,
          expected: state.doc.textBetween(from, to, " "),
        };
      }) ?? null;
  }, [run]);
  const insert = useCallback(
    (text: string) =>
      run((ctx) => {
        const saved = target.current;
        const view = ctx.get(editorViewCtx);
        const state = view.state;
        if (
          !saved ||
          (documentRevisionKey.getState(state) ?? 0) !== saved.revision ||
          state.doc.textBetween(saved.from, saved.to, " ") !== saved.expected
        )
          return false;
        view.dispatch(
          closeHistory(applyEditRange(state, ctx, saved.from, saved.to, text)),
        );
        target.current = null;
        return true;
      }) ?? false,
    [run],
  );
  return { capture, insert };
}
