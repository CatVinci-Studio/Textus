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
export { locateTarget } from "./pending-place";
export type { DecidedChange, SelectionTarget } from "./pending-place";
export type { ReviewStop } from "./pending-review";

/** `streaming`: the proposal exists but can't be decided yet. */
export type PendingStatus =
  | "pending"
  | "streaming"
  | "accepted"
  | "rejected"
  // A later proposal at the same spot took its place: not the user's verdict.
  | "replaced"
  | "invalid"
  | "expired"
  // A picture put into the text proposal it goes with, decided with it.
  | "joined";

/** What accepting a proposal does with its web citations. */
export interface CitationStyle {
  /** Settings' sourcesAsFootnotes, set from the proposal card. */
  asFootnotes: boolean;
  /** The conversation's sources, which title the footnotes. */
  sources: WebSource[];
}

/** Resolves proposals to document ranges and shows them as previews; lives
 *  as long as the editor. Anchors resolve in Markdown source, as the model
 *  saw it, and nothing writes a reply without a preview. */
export interface PendingEditOptions {
  /** The writer decided a proposal, change by change. No changes: an undo
   *  brought it back undecided. */
  onDecided?: (callId: string, changes: DecidedChange[]) => void;
  /** Saves an accepted picture and returns the src to write; null when the
   *  user cancelled. Throws when it can't be saved. */
  storeImage?: (
    image: GeneratedImageData,
    alt: string,
  ) => Promise<string | null>;
  /** Tells the user an accepted picture couldn't be saved. */
  onImageError?: (err: unknown) => void;
  /** An accepted picture replaced one in the document: the old one's src. */
  onPictureReplaced?: (oldSrc: string) => void;
  /** How an accepted proposal's web citations are written, asked when it
   *  is accepted. Left out: they are left out. */
  citationStyle?: () => CitationStyle;
  /** What a decision did, for a screen reader, wherever it was made. */
  onAnnounce?: (kind: "accepted" | "rejected", count: number) => void;
}

export function usePendingEdits(
  run: EditorRunner,
  options: PendingEditOptions = {},
) {
  const [previews, setPreviews] = useState<PendingPreview[]>([]);
  // Recorded statuses, kept after the preview leaves so a chat card never
  // reverts to "Pending".
  const [statuses, setStatuses] = useState<Record<string, RecordedStatus>>({});
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
    /** Every known status, for a detached chat window that can't read the
     *  previews. Live previews win over recorded statuses. */
    const allStatuses: Record<string, PendingStatus> = { ...statuses };
    for (const preview of previews)
      allStatuses[preview.callId] = liveStatus(preview);
    return {
      allStatuses,
      /** A proposal's status. One this editor never showed is no longer
       *  decidable, so it isn't "pending". */
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
