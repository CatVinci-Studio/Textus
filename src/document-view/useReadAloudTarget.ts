import { useCallback, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import { documentRevisionKey } from "../ai/workspace/revision-plugin";
import { speechHighlightKey } from "../voice/speech-highlight-plugin";
import type { SpeechChunk } from "../voice/speech-chunks";

export function useReadAloudTarget(run: EditorRunner) {
  const [range, setRange] = useState<"document" | "selection" | "cursor">(
    "document",
  );
  const captured = useRef<{
    revision: number;
    paragraphs: { start: number; end: number; from: number; to: number }[];
  } | null>(null);
  const getText = useCallback(
    () =>
      run((ctx) => {
        const state = ctx.get(editorViewCtx).state;
        const from = range === "document" ? 0 : state.selection.from;
        const to =
          range === "selection" ? state.selection.to : state.doc.content.size;
        const paragraphs: {
          start: number;
          end: number;
          from: number;
          to: number;
        }[] = [];
        let text = "";
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isTextblock) return;
          const start = Math.max(pos + 1, from);
          const end = Math.min(pos + 1 + node.content.size, to);
          const content =
            start < end ? state.doc.textBetween(start, end, " ") : "";
          if (content.trim()) {
            if (text) text += "\n\n";
            paragraphs.push({
              start: text.length,
              end: text.length + content.length,
              from: start,
              to: end,
            });
            text += content;
          }
          return false;
        });
        captured.current = {
          revision: documentRevisionKey.getState(state) ?? 0,
          paragraphs,
        };
        return text;
      }) ?? "",
    [run, range],
  );
  const highlight = useCallback(
    (chunk: SpeechChunk) =>
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const snapshot = captured.current;
        if (
          !snapshot ||
          (documentRevisionKey.getState(view.state) ?? 0) !== snapshot.revision
        )
          return false;
        const paragraph = snapshot.paragraphs.find(
          (p) => p.start <= chunk.start && chunk.start < p.end,
        );
        if (paragraph)
          view.dispatch(
            view.state.tr
              .setMeta(speechHighlightKey, {
                from: paragraph.from,
                to: paragraph.to,
              })
              .setMeta("addToHistory", false),
          );
        return true;
      }) ?? false,
    [run],
  );
  const clear = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr
          .setMeta(speechHighlightKey, null)
          .setMeta("addToHistory", false),
      );
    });
  }, [run]);
  return { range, setRange, getText, highlight, clear };
}
