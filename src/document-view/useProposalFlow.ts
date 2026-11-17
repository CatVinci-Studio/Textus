import { useCallback, useMemo, useRef } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { DocumentPort } from "../ai/chat/conversation/document-port";
import type { usePendingEdits } from "../ai/revision/usePendingEdits";
import type { SelectionTarget } from "../ai/revision/pending-place";
import { pendingEditKey } from "../ai/revision/pending-types";
import { stoppedRewrite } from "../ai/revision/pending-animation";
import { ProposalStream } from "../ai/revision/proposal-stream";
import {
  drawn,
  perCall,
  typewriter,
  type ProposalCanvas,
} from "../ai/revision/proposal-display";
import { isRefusal } from "../ai/revision/proposal-status";
import { isProposalTool } from "../ai/chat/proposal";
import type { EditProposal } from "../ai/types";
import type { StreamEvent } from "../platform/ipc";
import { prefersReducedMotion } from "../engine/motion/motion";
import { cachedDocument } from "../editor/markdown/doc-markdown";
import {
  generatedIdsIn,
  noteBegunPicture,
  withBegunPictures,
} from "../ai/revision/generated-images";
import { useLatest } from "../utils/hooks/useLatest";

type Proposed = { callId: string; proposal: EditProposal; streaming?: boolean };

/**
 * Proposals shown in the document. Re-prompting supersedes: a new
 * exchange's proposal replaces an undecided earlier one it overlaps, and
 * leaves the rest for the user to decide. Superseded proposals read as
 * "replaced", not "rejected", downstream.
 */
export function useAddPreviews(
  run: EditorRunner,
  pendingEdits: ReturnType<typeof usePendingEdits>,
) {
  const supersedePending = useRef(false);
  const earlierPreviews = useRef<Set<string>>(new Set());
  // Recorded at send time, so a selection made while the reply streams
  // can't redirect a replace_selection proposal.
  const requestTargetRef = useRef<SelectionTarget | null>(null);
  // The same, for a request from the detached window: the selection it was
  // shown when it asked for context, not whatever has been pushed since.
  const detachedTargetRef = useRef<SelectionTarget | null>(null);
  /** The earlier previews `added` stand on: same spot, same kind. */
  const supersededBy = useCallback(
    (added: Set<string>, earlier: Set<string>): string[] =>
      run((ctx) => {
        const previews =
          pendingEditKey.getState(ctx.get(editorViewCtx).state)?.previews ?? [];
        const now = previews.filter((p) => added.has(p.callId));
        return previews
          .filter((old) => earlier.has(old.callId) && !added.has(old.callId))
          .filter((old) => now.some((p) => sameSpot(old, p)))
          .map((old) => old.callId);
      }) ?? [],
    [run],
  );
  // Member functions only: the whole object is fresh every render and would
  // destabilize the ProposalStream memo.
  const {
    showPreviews,
    discard,
    replace,
    joinPicture,
    joinEdit,
    withdrawPictures,
  } = pendingEdits;
  const addPreviews = useCallback(
    (proposals: Proposed[], target: SelectionTarget | null) => {
      // Shown at once: a picture not painted yet is its frame in place.
      if (supersedePending.current) {
        supersedePending.current = false;
        earlierPreviews.current = new Set(
          run((ctx) =>
            (
              pendingEditKey.getState(ctx.get(editorViewCtx).state)?.previews ??
              []
            ).map((p) => p.callId),
          ) ?? [],
        );
      }
      // A rewrite stopped mid-stream offers what it reads as on screen; one
      // that completed no sentence offers nothing.
      const shown = proposals.flatMap((p) => {
        const kept = p.streaming ? undefined : stoppedRewrite(p.callId);
        if (kept === undefined) return [p];
        if (kept === null) {
          discard(p.callId);
          return [];
        }
        return [{ ...p, proposal: { ...p.proposal, text: kept } }];
      });
      // An edit of undecided text goes into that proposal, once it is
      // whole; a streaming one has its own preview until then.
      const text = shown.filter(
        (p) =>
          !p.proposal.image && (p.streaming || !joinEdit(p.callId, p.proposal)),
      );
      if (text.length > 0) showPreviews(text, target);
      const pictures = shown.filter(
        (p) =>
          p.proposal.image &&
          (p.streaming || !joinPicture(p.callId, p.proposal)),
      );
      if (pictures.length > 0) showPreviews(pictures, target);
      // A picture text now carries gives way as a proposal of its own.
      const carried = new Set(
        text.flatMap((p) => generatedIdsIn(p.proposal.text ?? "")),
      );
      if (carried.size > 0)
        withdrawPictures(carried, new Set(text.map((p) => p.callId)));
      const added = new Set(shown.map((p) => p.callId));
      for (const id of supersededBy(added, earlierPreviews.current)) {
        earlierPreviews.current.delete(id);
        replace(id);
      }
    },
    [
      showPreviews,
      discard,
      replace,
      joinPicture,
      joinEdit,
      withdrawPictures,
      supersededBy,
      run,
    ],
  );
  /** Shown against the selection the request was sent with. */
  const addRequested = useCallback(
    (proposals: Proposed[]) => addPreviews(proposals, requestTargetRef.current),
    [addPreviews],
  );
  /** A reply began: its proposals supersede what came before. */
  const armSupersede = useCallback(() => {
    supersedePending.current = true;
  }, []);
  return {
    supersedePending,
    requestTargetRef,
    detachedTargetRef,
    addPreviews,
    addRequested,
    armSupersede,
  };
}

/** This document as a conversation reaches it, whenever it sends: the
 *  ProposalStream machine drawing a streaming propose_edit in the editor. */
export function useDocumentPort({
  run,
  filePath,
  addRequested,
  discard,
  markSent,
  allStatuses,
}: {
  run: EditorRunner;
  filePath: string | null;
  addRequested: (proposals: Proposed[]) => void;
  discard: (callId: string) => void;
  markSent: (callId: string) => void;
  allStatuses: ReturnType<typeof usePendingEdits>["allStatuses"];
}) {
  // Reduced motion renders widgets instantly: the typewriter's entries
  // would never be revealed (or settle).
  const animated = useCallback(() => !prefersReducedMotion(), []);
  const proposalStream = useMemo(() => {
    // Pictures written into the text show as their frames.
    const canvas: ProposalCanvas = {
      text: withBegunPictures,
      show: (callId, proposal, streaming) => {
        addRequested([
          {
            callId,
            proposal: {
              ...proposal,
              text: withBegunPictures(callId, proposal.text ?? ""),
            },
            streaming: streaming || undefined,
          },
        ]);
      },
      discard,
    };
    return new ProposalStream(
      perCall(
        { typewriter: typewriter(canvas), drawn: drawn(canvas) },
        animated,
      ),
      () =>
        run(
          (ctx) => cachedDocument(ctx, ctx.get(editorViewCtx).state.doc).blocks,
        ) ?? [],
    );
  }, [addRequested, discard, run, animated]);
  // Not memoized: the conversations reach it through `port`.
  const handleStreamEvent = (event: StreamEvent) => {
    // A picture written into a proposal's text is being made: show its frame.
    if (event.type === "picture") {
      noteBegunPicture(event.callId, event.line, event.id, {
        width: event.width,
        height: event.height,
      });
      return;
    }
    // A garbled step is asked for again: drop its drafts, as on failure.
    if (event.type === "retry") {
      proposalStream.finish("failed");
      return;
    }
    if (event.type === "turn" && event.turn.kind === "ToolResult") {
      const refused = isRefusal(event.turn.output);
      // Written straight in only once the backend took it whole: never a
      // draft cut off by Stop, nor one it then refused.
      if (!refused) markSent(event.turn.call_id);
      proposalStream.result(event.turn.call_id, refused);
    } else if (event.type === "toolStart")
      proposalStream.toolStart(event.callId, event.name);
    else if (event.type === "toolArgsDelta")
      proposalStream.argsDelta(event.callId, event.delta);
    else if (
      event.type === "turn" &&
      event.turn.kind === "ToolCall" &&
      isProposalTool(event.turn.name)
    )
      proposalStream.finalCall(event.turn.call_id, event.turn.arguments);
  };
  const streamEvent = useLatest(handleStreamEvent);
  const statuses = useLatest(allStatuses);
  return useMemo(
    (): DocumentPort => ({
      docPath: filePath,
      onStreamEvent: (event) => streamEvent.current(event),
      // Drafts still open at the end: a stop keeps the typed text as a
      // preview, a failure drops it so Retry doesn't write it twice.
      onReplyEnd: (failed) =>
        proposalStream.finish(failed ? "failed" : "stopped"),
      proposalStatuses: () => statuses.current,
    }),
    [filePath, streamEvent, statuses, proposalStream],
  );
}

/** Whether two proposals stand on the same spot, of the same kind: their
 *  ranges overlap, or two insertions share a point. */
function sameSpot(
  a: { from: number; to: number; proposal: EditProposal },
  b: { from: number; to: number; proposal: EditProposal },
): boolean {
  if (!!a.proposal.image !== !!b.proposal.image) return false;
  const point = (p: { from: number; to: number }) => p.from === p.to;
  if (point(a) && point(b)) return a.from === b.from;
  if (point(a)) return b.from < a.from && a.from < b.to;
  if (point(b)) return a.from < b.from && b.from < a.to;
  return a.from < b.to && b.from < a.to;
}
