import { useMemo, useRef, useState } from "react";
import type { EditorRunner } from "../../editor/useEditorRunner";
import type { GeneratedImageData } from "../../platform/ipc";
import { useLatest } from "../../utils/hooks/useLatest";
import type { WebSource } from "../types";
import { makePendingActions } from "./pending-actions";
import type { PendingPreview } from "./pending-edit-plugin";
import type { DecidedChange } from "./pending-place";
import { useReviewNavigation } from "./pending-review";
import { liveStatus, type RecordedStatus } from "./proposal-lifecycle";
import { usePicturesState } from "./usePicturesState";

export { locateAnchor } from "./pending-place";
export type { DecidedChange, SelectionTarget } from "./pending-place";
export type { ReviewStop } from "./pending-review";

/** `streaming`: the proposal exists but can't be decided yet - its
 *  arguments are still arriving or its text is still typing into the
 *  document (pending-edit-plugin settles it when the reveal completes). */
export type PendingStatus =
  | "pending"
  | "streaming"
  | "accepted"
  | "rejected"
  // A later request's proposal at the same spot took its place
  // (useEditorProposals' supersededBy) - not the user's verdict.
  | "replaced"
  | "invalid"
  | "expired"
  // A picture put into the text proposal it goes with (joinPicture),
  // decided with it.
  | "joined";

/** What accepting a proposal does with its web citations (citations.ts). */
export interface CitationStyle {
  /** Settings' sourcesAsFootnotes, set from the proposal card. */
  asFootnotes: boolean;
  /** The conversation's sources, which title the footnotes. */
  sources: WebSource[];
}

/**
 * Resolves propose_edit proposals to live document ranges and shows them as
 * in-document decorations (pending-edit-plugin.ts). Accept/reject lives in
 * the chat's proposal card (ChatMessages.tsx) and calls in here - the
 * decorations are display only, so there is exactly one set of controls for
 * one action. Owned by MilkdownEditor, same lifetime as the editor, so
 * previews survive the chat popup closing and reopening.
 *
 * Anchors resolve in MARKDOWN SOURCE (doc-markdown.ts), matching what the
 * model was shown. This is the only path that writes a reply into the
 * document; there is deliberately no direct-apply fallback that skips the
 * preview. The full proposal lifecycle - streaming, stop/failure endings,
 * what a consecutive prompt supersedes - is laid out in docs/design/ai-proposals.md.
 */
export interface PendingEditOptions {
  /** The writer accepted or rejected a proposal (not one superseded,
   *  refused or stopped): what it decided, change by change - in place of
   *  what it decided about it before. No changes: an undo brought an
   *  accepted proposal back, undecided again. */
  onDecided?: (callId: string, changes: DecidedChange[]) => void;
  /** Saves an accepted picture the way Settings › Images says and returns
   *  the src to write - null when the user cancelled (naming it). Throws
   *  when it can't be saved. */
  storeImage?: (
    image: GeneratedImageData,
    alt: string,
  ) => Promise<string | null>;
  /** Tells the user an accepted picture couldn't be saved. */
  onImageError?: (err: unknown) => void;
  /** An accepted picture replaced one already in the document (a redone
   *  picture, generate_image's `replace`): the old one's src, for the
   *  owner to offer moving its file to the Trash. */
  onPictureReplaced?: (oldSrc: string) => void;
  /** How an accepted proposal's web citations are written, asked when it
   *  is accepted. Left out: they are left out. */
  citationStyle?: () => CitationStyle;
  /** What a decision did, said to a screen reader (useEditorProposals):
   *  how many changes the writer accepted or rejected, wherever it was
   *  decided - the review bar, a ✓ / ✕, a card, Ctrl/⌘ + Enter. */
  onAnnounce?: (kind: "accepted" | "rejected", count: number) => void;
}

export function usePendingEdits(
  run: EditorRunner,
  options: PendingEditOptions = {},
) {
  const [previews, setPreviews] = useState<PendingPreview[]>([]);
  // callId -> terminal status, kept even after the preview leaves `previews`
  // (accept/reject/an invalidating edit all remove it) so a chat card can
  // still show "Applied"/"Rejected"/"Couldn't locate" instead of reverting
  // to a plain, misleading "Pending". Recorded statuses only
  // (proposal-lifecycle.ts): a preview in the document reads its own.
  const [statuses, setStatuses] = useState<Record<string, RecordedStatus>>({});
  // Going through them one by one: the review bar's stops and count,
  // Quick Ask's pointer (pending-review.ts).
  const nav = useReviewNavigation(previews);
  // A picture still being made in a pending proposal: Accept waits for it.
  const picturesPainting =
    usePicturesState(previews.map((p) => p.proposal.text ?? "").join("\n")) ===
    "painting";

  // What the actions read when they run, and what they keep between runs.
  const latest = useLatest({
    options,
    previews,
    reviewCount: nav.reviewCount,
    focusedCallId: nav.focusedCallId,
    step: nav.step,
  });
  const mutable = useRef({
    reportedAccepts: new Set<string>(),
    knownIds: new Set<string>(),
    savingImages: new Set<string>(),
  });
  const actions = useMemo(
    () =>
      makePendingActions({
        run,
        options: () => latest.current.options,
        latest: () => latest.current,
        setPreviews,
        setStatuses,
        mutable: mutable.current,
      }),
    [run, latest],
  );

  const derived = useMemo(() => {
    /** Every known proposal's status in one object - what gets pushed to a
     *  detached chat window, which has no access to editor state and so
     *  can't derive "pending" from the live preview list itself. Live
     *  previews win over recorded terminal statuses. */
    const allStatuses: Record<string, PendingStatus> = { ...statuses };
    for (const preview of previews)
      allStatuses[preview.callId] = liveStatus(preview);
    return {
      allStatuses,
      /** Per-callId view of `allStatuses` - what the local chat card asks.
       *  A proposal this editor never showed - from a restored
       *  conversation, or one that ended before this session - is no
       *  longer decidable: "pending" offered Accept buttons that could only
       *  fail. (A card arriving mid-request reads as streaming instead: see
       *  ChatMessages.) */
      status: (callId: string): PendingStatus =>
        allStatuses[callId] ?? "expired",
      /** A proposal's sentences as the card lists them - null when it
       *  isn't pending or isn't shown sentence by sentence. */
      sentences: (callId: string) =>
        previews.find((p) => p.callId === callId && !p.streaming)?.sentences
          ?.changes ?? null,
    };
  }, [previews, statuses]);

  return {
    ...actions,
    ...derived,
    previews,
    picturesPainting,
    decidable: nav.decidable,
    reviewed: nav.reviewed,
    reviewStreaming: nav.reviewStreaming,
    reviewStops: nav.reviewStops,
    reviewCount: nav.reviewCount,
    stopIndex: nav.stopIndex,
    focusedStop: nav.focusedStop,
    stepReview: nav.stepReview,
    pointReview: nav.pointReview,
    focusIndex: nav.focusIndex,
    focusedPreview: nav.focusedPreview,
  };
}
