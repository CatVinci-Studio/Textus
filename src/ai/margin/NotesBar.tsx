import { useRef } from "react";
import { ChevronIcon } from "../../ui/icons";
import { usePresenceProps } from "../../ui/usePresence";
import { Tooltip } from "../../ui/Tooltip";
import type { NotesBarState } from "./useNotesBar";
import "../revision/ReviewBar.css";

export interface NotesBarLabels {
  reviewNotesLabel: string;
  reviewNotePrev: string;
  reviewNoteNext: string;
  reviewGroupNotes: string;
  quickAskPosition: string;
  reviewNotesPick: string;
  reviewNotesAllDone: string;
  reviewNotesPicked: string;
  reviewNoteAsk: string;
  cancel: string;
}

/**
 * The review notes' bar, the review bar's twin (ReviewBar.tsx): over the
 * bottom of the document while there are notes, above the review bar when
 * both show. Step through the notes (‹ 3/24 ›), mark them all done, or
 * pick some and ask about them together - a long review left a column of
 * notes to be dismissed one by one.
 */
export function NotesBar({
  bar,
  labels,
  raised,
  canPick,
}: {
  bar: NotesBarState;
  labels: NotesBarLabels;
  /** The review bar shows too: this one stands above it. */
  raised: boolean;
  /** Picking needs the margin's cards (not a phone's badges). */
  canPick: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const presence = usePresenceProps(rootRef);
  const picking = bar.picked !== null;
  const nav = bar.count > 1 && (
    <span className="review-bar-nav">
      <Tooltip text={labels.reviewNotePrev} side="above">
        <button
          type="button"
          aria-label={labels.reviewNotePrev}
          onClick={() => bar.step(-1)}
        >
          <ChevronIcon className="review-bar-prev" />
        </button>
      </Tooltip>
      <span className="review-bar-pos">
        {bar.position < 0
          ? labels.reviewGroupNotes.replace("{n}", String(bar.count))
          : labels.quickAskPosition
              .replace("{i}", String(bar.position + 1))
              .replace("{n}", String(bar.count))}
      </span>
      <Tooltip text={labels.reviewNoteNext} side="above">
        <button
          type="button"
          aria-label={labels.reviewNoteNext}
          onClick={() => bar.step(1)}
        >
          <ChevronIcon className="review-bar-next" />
        </button>
      </Tooltip>
    </span>
  );
  return (
    <div
      {...presence}
      className={`review-bar review-bar-notes${raised ? " review-bar-raised" : ""}`}
      role="toolbar"
      aria-label={labels.reviewNotesLabel}
    >
      <div className="review-bar-top">
        <span className="review-bar-label">
          {picking
            ? labels.reviewNotesPicked.replace(
                "{n}",
                String(bar.picked?.size ?? 0),
              )
            : labels.reviewNotesLabel}
        </span>
        {!picking && nav}
      </div>
      <span className="review-bar-sep" aria-hidden="true" />
      <div className="review-bar-actions">
        {picking ? (
          <>
            <button
              type="button"
              className="review-bar-button review-bar-primary"
              disabled={(bar.picked?.size ?? 0) === 0}
              onClick={bar.askPicked}
            >
              {labels.reviewNoteAsk}
            </button>
            <button
              type="button"
              className="review-bar-button"
              onClick={bar.stopPicking}
            >
              {labels.cancel}
            </button>
          </>
        ) : (
          <>
            {canPick && bar.count > 1 && (
              <button
                type="button"
                className="review-bar-button"
                onClick={bar.startPicking}
              >
                {labels.reviewNotesPick}
              </button>
            )}
            <button
              type="button"
              className="review-bar-button review-bar-primary"
              onClick={bar.allDone}
            >
              {labels.reviewNotesAllDone}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
