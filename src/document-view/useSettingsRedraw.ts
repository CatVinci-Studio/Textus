import { useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { Settings } from "../settings/SettingsContext";

/**
 * Decorations draw only on a transaction, so settings they read (language,
 * line numbers, swatches, diagram engine) need one dispatched on change,
 * or they wait for the next keystroke.
 */
export function useSettingsRedraw(run: EditorRunner, settings: Settings) {
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta("addToHistory", false));
    });
  }, [
    settings.language,
    settings.codeLineNumbers,
    settings.colorSwatches,
    settings.diagramEngine,
    run,
  ]);
}
