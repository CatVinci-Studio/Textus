import { useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { Settings } from "../settings/SettingsContext";

/**
 * The empty-document placeholder reads the language when it draws, the
 * code blocks' line numbers, the colour swatches and the diagrams their
 * settings, and decorations only draw on a transaction (the diagrams
 * check their engine on one): without one, switching the language in
 * Settings (or on the first-run picker) left the old text, and those
 * settings did nothing until the next keystroke.
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
