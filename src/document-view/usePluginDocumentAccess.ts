import { useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import {
  cachedDocumentMarkdown,
  caretContext,
  readSelection,
} from "../ai/doc-markdown";
import { setActiveDocument, type ActiveDocumentAccess } from "../plugins/app-bridge";
import type { useEditorProposals } from "./useEditorProposals";

/**
 * The active tab's editor, as plugins reach it (plugins/app-bridge.ts):
 * its Markdown and selection, and edits shown as proposals the user
 * accepts or rejects - the same previews Textus AI's edits are, aimed at
 * the selection as it is when the plugin asks.
 */
export function usePluginDocumentAccess({
  run,
  isActive,
  filePath,
  addPreviews,
}: {
  run: EditorRunner;
  isActive: boolean;
  filePath: string | null;
  addPreviews: ReturnType<typeof useEditorProposals>["addPreviews"];
}): void {
  useEffect(() => {
    if (!isActive) return;
    const access: ActiveDocumentAccess = {
      path: filePath,
      text: () =>
        run((ctx) => cachedDocumentMarkdown(ctx, ctx.get(editorViewCtx).state.doc)) ?? "",
      selection: () =>
        run((ctx) => {
          const { state } = ctx.get(editorViewCtx);
          const { from, to } = state.selection;
          return {
            text: state.doc.textBetween(from, to, "\n"),
            markdown: readSelection(ctx, state).selectionMarkdown,
          };
        }) ?? { text: "", markdown: null },
      propose: (callId, proposal) => {
        const target = run((ctx) => {
          const { state } = ctx.get(editorViewCtx);
          const selection = readSelection(ctx, state);
          return {
            range: selection.range,
            selectionMarkdown: selection.selectionMarkdown,
            cursor: caretContext(state)?.pos ?? null,
          };
        });
        if (!target) return false;
        addPreviews([{ callId, proposal }], target);
        return true;
      },
    };
    setActiveDocument(access);
    return () => setActiveDocument(null, access);
  }, [run, isActive, filePath, addPreviews]);
}
