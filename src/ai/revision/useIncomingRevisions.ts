import { useEffect, useReducer } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";
import { useWindowEvent } from "../../utils/hooks/useWindowEvent";
import { serializeBlocks } from "../../editor/markdown/doc-markdown";
import {
  FILE_REVISIONS_EVENT,
  revisionProposals,
  updateFileRevisions,
} from "./file-revisions";
import type { ProposalToPlace, SelectionTarget } from "./pending-place";

/**
 * Changes Textus AI kept as revisions for this file while it wasn't open
 * (file-revisions.ts), placed as revisions in its text once its editor is
 * ready, and again as more come. A file that reads otherwise than the
 * change found it gets none of them: the change is marked a conflict and
 * listed in its conversation's card instead of being lost.
 */
export function useIncomingRevisions({
  run,
  filePath,
  restored,
  showPreviews,
}: {
  run: EditorRunner;
  filePath: string | null;
  /** Its kept proposals are back in it. */
  restored: boolean;
  showPreviews: (
    proposals: ProposalToPlace[],
    target: SelectionTarget | null,
  ) => void;
}) {
  const ready = run(() => true) === true;
  const [more, arrived] = useReducer((n: number) => n + 1, 0);
  useWindowEvent(FILE_REVISIONS_EVENT, (e) => {
    if ((e as CustomEvent<string>).detail === filePath) arrived();
  });
  useEffect(() => {
    // After its kept proposals are back: placed before, they were written
    // over by the restore's empty list.
    if (!ready || !restored || !filePath) return;
    let cancelled = false;
    void updateFileRevisions(filePath, (kept) => {
      const waiting = kept.incoming.filter((r) => !r.conflict);
      if (cancelled || !waiting.length) return undefined;
      for (const revision of waiting) {
        const placed = run((ctx) => {
          const blocks = serializeBlocks(ctx, ctx.get(editorViewCtx).state.doc);
          const read = (text: string) => {
            const doc = parseMarkdownSource(ctx, text);
            return doc && typeof doc !== "string"
              ? serializeBlocks(ctx, doc).map((b) => b.markdown)
              : null;
          };
          const before = read(revision.before);
          const after = read(revision.after);
          // Unreadable, or the file reads otherwise now: kept apart.
          if (!before || !after) return "conflict";
          const now = blocks.map((b) => b.markdown);
          if (before.join("\n\n") !== now.join("\n\n")) return "conflict";
          return revisionProposals(blocks, after);
        });
        if (placed === undefined) return undefined;
        if (placed === "conflict") {
          revision.conflict = true;
          continue;
        }
        const last = revision.ids[revision.ids.length - 1];
        showPreviews(
          placed.map((proposal, i) => ({ callId: `${last}:${i}`, proposal })),
          null,
        );
        kept.incoming = kept.incoming.filter((r) => r !== revision);
      }
      return kept;
    });
    return () => {
      cancelled = true;
    };
  }, [ready, restored, filePath, more, run, showPreviews]);
}
