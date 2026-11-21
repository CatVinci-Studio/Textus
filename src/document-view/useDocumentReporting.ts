import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { leaveHistory } from "../editor/left-history";
import { whenIdle } from "../lazy/lazy-module";
import { registerTabEditor } from "../editor/tab-editor";
import { leaveTab } from "../editor/tab-left";
import { singleTildeCtx } from "../editor/opened-from";
import {
  readSourceBlocks,
  writePreservingSource,
} from "../editor/markdown/source-preserving";
import type { SourceBlocks } from "../editor/markdown/source-parts";
import type { EditorRunner } from "../editor/useEditorRunner";
import { useLatest } from "../utils/hooks/useLatest";

/** How one tab's editor hands its markdown to the tab: debounced reports,
 *  and the immediate flush. */
export interface DocumentReporting {
  reportedDocRef: { current: ProseNode | null };
  reportedMarkdownRef: { current: string | null };
  /** The text this editor opened with. */
  openedValueRef: { readonly current: string };
  /** The editor has mounted with `doc`, read from the opened file. */
  onMounted: (ctx: Ctx, doc: ProseNode) => void;
  reportDoc: (ctx: Ctx, doc: ProseNode) => void;
  /** What a save writes for `doc`: the file's own text where unchanged. */
  textOf: (ctx: Ctx, doc: ProseNode) => string;
}

/** What a save writes for a doc: the opened file, paired block by block
 *  with the doc it opened as (`pair`), so unchanged blocks are written as
 *  the file has them and an unedited document stays byte-identical. */
function useFileText(openedValueRef: { readonly current: string }) {
  const mountDocRef = useRef<ProseNode | null>(null);
  const sourceRef = useRef<SourceBlocks | null>(null);
  // Without that pairing: a doc that serializes as it opened is reported as
  // the file's own text.
  const mountMarkdownRef = useRef<string | null>(null);
  // Paired once the tab is drawn (a long file is parsed again for it), or
  // at once when its text is wanted first.
  const pendingRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      pendingRef.current = null;
    },
    [],
  );
  const pair = useCallback(
    (ctx: Ctx, doc: ProseNode) => {
      mountDocRef.current = doc;
      sourceRef.current = null;
      const run = () => {
        if (pendingRef.current !== run) return;
        pendingRef.current = null;
        sourceRef.current = readSourceBlocks(ctx, openedValueRef.current, doc);
      };
      pendingRef.current = run;
      whenIdle(run);
    },
    [openedValueRef],
  );
  const textOf = useCallback(
    (ctx: Ctx, doc: ProseNode) => {
      pendingRef.current?.();
      const source = sourceRef.current;
      if (source) return writePreservingSource(ctx, source, doc);
      const serializer = ctx.get(serializerCtx);
      const mountDoc = mountDocRef.current;
      if (mountDoc && mountMarkdownRef.current === null)
        mountMarkdownRef.current = serializer(mountDoc);
      const markdown = serializer(doc);
      return markdown === mountMarkdownRef.current
        ? openedValueRef.current
        : markdown;
    },
    [openedValueRef],
  );
  return { pair, textOf };
}

export function useDocumentReporting(
  initialValue: string,
  onChange: (markdown: string) => void,
): DocumentReporting {
  const onChangeRef = useLatest(onChange);
  // The doc and markdown last handed to onChange, for flushing an edit the
  // debounce still holds.
  const reportedDocRef = useRef<ProseNode | null>(null);
  const reportedMarkdownRef = useRef<string | null>(null);
  const openedValueRef = useRef(initialValue);
  const { pair, textOf } = useFileText(openedValueRef);
  const onMounted = useCallback(
    (ctx: Ctx, doc: ProseNode) => {
      reportedDocRef.current = doc;
      pair(ctx, doc);
    },
    [pair],
  );
  const reportDoc = useCallback(
    (ctx: Ctx, doc: ProseNode) => {
      const value = textOf(ctx, doc);
      reportedMarkdownRef.current = value;
      onChangeRef.current(value);
    },
    [onChangeRef, textOf],
  );
  return {
    reportedDocRef,
    reportedMarkdownRef,
    openedValueRef,
    onMounted,
    reportDoc,
    textOf,
  };
}

/** Registers this editor's flush under its tab. */
export function useEditorFlush(
  tabId: string,
  run: EditorRunner,
  {
    reportedDocRef,
    reportedMarkdownRef,
    openedValueRef,
    reportDoc,
  }: DocumentReporting,
  /** The file it shows: what it leaves is for that file only. */
  filePathRef: { readonly current: string | null },
) {
  const flush = useCallback(
    () =>
      run((ctx) => {
        const { doc } = ctx.get(editorViewCtx).state;
        const reported = reportedDocRef.current;
        if (reported && !doc.eq(reported)) {
          reportedDocRef.current = doc;
          reportDoc(ctx, doc);
        }
        return reportedMarkdownRef.current;
      }) ?? null,
    [run, reportDoc, reportedDocRef, reportedMarkdownRef],
  );
  // The debounce reports the same doc again later: a harmless repeat.
  useEffect(() => registerTabEditor(tabId, "flush", flush), [tabId, flush]);
  // Let go when its tab leaves the front: what was typed a moment before
  // goes out first, then the editor's own state for the tab's next one,
  // while it is still there to read them from.
  const leave = useLatest(() => {
    const markdown = flush() ?? openedValueRef.current;
    run((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      leaveTab(tabId, {
        path: filePathRef.current,
        markdown,
        doc: state.doc.toJSON(),
        selection: state.selection.toJSON(),
        history: leaveHistory(state),
        singleTilde: ctx.get(singleTildeCtx.key),
      });
    });
  });
  useLayoutEffect(() => () => leave.current(), [leave]);
}
