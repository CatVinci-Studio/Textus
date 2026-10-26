import { useCallback, useEffect, useRef } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { registerEditorFlush } from "../editor/editor-flush";
import {
  readSourceBlocks,
  writePreservingSource,
  type SourceBlocks,
} from "../editor/markdown/source-preserving";
import type { EditorRunner } from "../editor/useEditorRunner";
import { useLatest } from "../utils/hooks/useLatest";

/** How one tab's editor hands its markdown to the tab: debounced reports,
 *  and the immediate flush. */
export interface DocumentReporting {
  reportedDocRef: { current: ProseNode | null };
  reportedMarkdownRef: { current: string | null };
  /** The editor has mounted with `doc`, read from the opened file. */
  onMounted: (ctx: Ctx, doc: ProseNode) => void;
  reportDoc: (ctx: Ctx, doc: ProseNode) => void;
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
  // The opened file, paired block by block with its doc: a save writes
  // unchanged blocks as the file has them, so an unedited document stays
  // byte-identical and clean.
  const openedValueRef = useRef(initialValue);
  const mountDocRef = useRef<ProseNode | null>(null);
  const sourceRef = useRef<SourceBlocks | null>(null);
  // Without that pairing: a doc that serializes as it opened is reported as
  // the file's own text.
  const mountMarkdownRef = useRef<string | null>(null);
  const onMounted = useCallback((ctx: Ctx, doc: ProseNode) => {
    reportedDocRef.current = doc;
    mountDocRef.current = doc;
    sourceRef.current = readSourceBlocks(ctx, openedValueRef.current, doc);
  }, []);
  const reportDoc = useCallback(
    (ctx: Ctx, doc: ProseNode) => {
      const source = sourceRef.current;
      let value: string;
      if (source) value = writePreservingSource(ctx, source, doc);
      else {
        const serializer = ctx.get(serializerCtx);
        const mountDoc = mountDocRef.current;
        if (mountDoc && mountMarkdownRef.current === null)
          mountMarkdownRef.current = serializer(mountDoc);
        const markdown = serializer(doc);
        value =
          markdown === mountMarkdownRef.current
            ? openedValueRef.current
            : markdown;
      }
      reportedMarkdownRef.current = value;
      onChangeRef.current(value);
    },
    [onChangeRef],
  );
  return { reportedDocRef, reportedMarkdownRef, onMounted, reportDoc };
}

/** Registers this editor's flush under its tab. */
export function useEditorFlush(
  tabId: string,
  run: EditorRunner,
  { reportedDocRef, reportedMarkdownRef, reportDoc }: DocumentReporting,
) {
  // The debounce reports the same doc again later: a harmless repeat.
  useEffect(
    () =>
      registerEditorFlush(
        tabId,
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
      ),
    [tabId, run, reportDoc, reportedDocRef, reportedMarkdownRef],
  );
}
