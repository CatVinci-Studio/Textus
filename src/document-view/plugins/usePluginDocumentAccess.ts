import { useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../../editor/useEditorRunner";
import {
  lineAndColumn,
  markdownOffsetAt,
} from "../../editor/modes/mode-switch";
import {
  cachedDocument,
  caretContext,
  readSelection,
} from "../../editor/markdown/doc-markdown";
import {
  setActiveDocument,
  type ActiveDocumentAccess,
} from "../../plugins/app-bridge";
import {
  setOpenDocument,
  type OpenDocumentAccess,
} from "../../registry/open-documents";
import {
  applyPluginEdits,
  documentRevision,
  replaceDocument,
  revealPlace,
} from "./plugin-edits";
import type { useEditorProposals } from "../useEditorProposals";
import type { DocumentReporting } from "../useDocumentReporting";

/**
 * A tab's editor as plugins reach it: while active, its Markdown, selection,
 * edits and proposals; in any tab, its text to read and change in place.
 */
export function usePluginDocumentAccess({
  run,
  isActive,
  filePath,
  addPreviews,
  textOf,
}: {
  run: EditorRunner;
  isActive: boolean;
  filePath: string | null;
  addPreviews: ReturnType<typeof useEditorProposals>["addPreviews"];
  /** What a save would write now: a plugin reads the document as the file
   *  will be, not as the editor alone would write it. */
  textOf: DocumentReporting["textOf"];
}): void {
  useEffect(() => {
    if (!filePath) return;
    const text = () =>
      run((ctx) => textOf(ctx, ctx.get(editorViewCtx).state.doc)) ?? "";
    const access: OpenDocumentAccess = {
      text,
      revision: () => documentRevision(text()),
      replaceText: (next, revision) =>
        documentRevision(text()) === revision &&
        (run((ctx) => replaceDocument(ctx, next)) ?? false),
    };
    setOpenDocument(filePath, access);
    return () => setOpenDocument(filePath, null, access);
  }, [run, filePath, textOf]);

  useEffect(() => {
    if (!isActive) return;
    const access: ActiveDocumentAccess = {
      path: filePath,
      text: () =>
        run((ctx) => textOf(ctx, ctx.get(editorViewCtx).state.doc)) ?? "",
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
      cursor: () =>
        run((ctx) => {
          const { state } = ctx.get(editorViewCtx);
          const markdown = textOf(ctx, state.doc);
          const at = (pos: number) =>
            lineAndColumn(markdown, markdownOffsetAt(ctx, markdown, pos));
          return {
            anchor: at(state.selection.anchor),
            head: at(state.selection.head),
          };
        }) ?? null,
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
  }, [run, isActive, filePath, addPreviews, textOf]);
}
