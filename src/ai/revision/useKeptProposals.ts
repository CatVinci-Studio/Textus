import { useEffect, useReducer, useRef } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { ai } from "../../platform/ipc";
import { fnv1a } from "../../utils/hash";
import { cachedDocumentMarkdown, serializeRange } from "../doc-markdown";
import { onPictureSettled, pictureState } from "./generated-images";
import { keptFrom, picturesOf, readKept, restorable } from "./kept-proposals";
import type { SelectionTarget } from "./pending-place";
import type { ProposalToPlace } from "./pending-place";
import type { PendingPreview } from "./pending-types";

/** How long the proposals settle before they are written down: a review
 *  bar run through them writes once at the end, not at every step. */
const WRITE_AFTER_MS = 400;

/** Keeps the document's undecided proposals with it, restoring them on open.
 *  Nothing is written before they are restored, so opening never wipes them. */
export function useKeptProposals({
  run,
  filePath,
  workspaceRoot,
  previews,
  showPreviews,
  decide,
}: {
  run: EditorRunner;
  filePath: string | null;
  workspaceRoot: string | null;
  previews: PendingPreview[];
  showPreviews: (
    proposals: ProposalToPlace[],
    target: SelectionTarget | null,
  ) => void;
  decide: (callId: string, index: number, take: boolean | null) => void;
}) {
  // The document whose kept proposals this editor has offered again.
  const restored = useRef<string | null>(null);
  // What was last written for it, so an unchanged list isn't written again.
  const written = useRef<string | null>(null);
  const ready = run(() => true) === true;
  // A picture made since: its proposal may be kept now.
  const [pictures, picturesSettled] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onPictureSettled(picturesSettled), []);

  useEffect(() => {
    if (!ready || !filePath || restored.current === filePath) return;
    let cancelled = false;
    written.current = null;
    void ai
      .keptProposalsRead(filePath, workspaceRoot)
      .catch(() => null)
      .then((value) => {
        if (cancelled) return;
        restored.current = filePath;
        const kept = readKept(value);
        if (!kept) return;
        written.current = JSON.stringify(kept);
        const document = run((ctx) =>
          fnv1a(cachedDocumentMarkdown(ctx, ctx.get(editorViewCtx).state.doc)),
        );
        if (document === undefined) return;
        for (const { callId, proposal, target, takes } of restorable(
          kept,
          document,
        )) {
          showPreviews([{ callId, proposal }], target ?? null);
          takes?.forEach((take, index) => {
            if (take !== null) decide(callId, index, take);
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, filePath, workspaceRoot, run, showPreviews, decide]);

  useEffect(() => {
    if (!filePath || restored.current !== filePath) return;
    const write = () => {
      const kept = run((ctx) => {
        const doc = ctx.get(editorViewCtx).state.doc;
        return keptFrom(
          previews,
          fnv1a(cachedDocumentMarkdown(ctx, doc)),
          (from, to) => serializeRange(ctx, doc, from, to),
          (id) => pictureState(id) === "ready",
        );
      });
      if (kept === undefined) return;
      const json = kept ? JSON.stringify(kept) : null;
      if (json === written.current) return;
      written.current = json;
      void ai
        .keptProposalsWrite(filePath, workspaceRoot, kept, picturesOf(kept))
        .catch(() => undefined);
    };
    const timer = window.setTimeout(write, WRITE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [previews, pictures, filePath, workspaceRoot, run]);
}
