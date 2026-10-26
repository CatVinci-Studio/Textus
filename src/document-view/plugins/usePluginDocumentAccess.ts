import { useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../../editor/useEditorRunner";
import {
  cachedDocument,
  caretContext,
  readSelection,
} from "../../ai/doc-markdown";
import {
  setActiveDocument,
  setOpenDocument,
  type ActiveDocumentAccess,
  type OpenDocumentAccess,
} from "../../plugins/app-bridge";
import {
  applyPluginEdits,
  documentRevision,
  replaceDocument,
  revealPlace,
} from "./plugin-edits";
import type { useEditorProposals } from "../useEditorProposals";

/**
 * A tab's editor, as plugins reach it (plugins/app-bridge.ts): while it is
 * the active tab, its Markdown and selection, edits made at once or shown
 * as proposals the user accepts or rejects - the same previews Textus AI's
 * edits are - and a place to go to; and, open in any tab, its text to read
 * and change in place (textus.files.process), so nothing typed is lost.
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
    if (!filePath) return;
    const text = () =>
      run(
        (ctx) => cachedDocument(ctx, ctx.get(editorViewCtx).state.doc).markdown,
      ) ?? "";
    const access: OpenDocumentAccess = {
      text,
      revision: () => documentRevision(text()),
      replaceText: (next, revision) =>
        documentRevision(text()) === revision &&
        (run((ctx) => replaceDocument(ctx, next)) ?? false),
    };
    setOpenDocument(filePath, access);
    return () => setOpenDocument(filePath, null, access);
  }, [run, filePath]);

  useEffect(() => {
    if (!isActive) return;
    const access: ActiveDocumentAccess = {
      path: filePath,
      text: () =>
        run(
          (ctx) =>
            cachedDocument(ctx, ctx.get(editorViewCtx).state.doc).markdown,
        ) ?? "",
      blocks: () =>
        run(
          (ctx) => cachedDocument(ctx, ctx.get(editorViewCtx).state.doc).blocks,
        ) ?? [],
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
      edit: (edits) => run((ctx) => applyPluginEdits(ctx, edits)) ?? false,
      reveal: (place) => run((ctx) => revealPlace(ctx, place)) ?? false,
    };
    setActiveDocument(access);
    return () => setActiveDocument(null, access);
  }, [run, isActive, filePath, addPreviews]);
}
