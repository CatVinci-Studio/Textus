import { tabElement } from "../../engine/layout/tab-element";
import { InlineMarkdownText } from "../MarkdownText";
import { memo } from "react";
import { createPortal } from "react-dom";
import type { ReviewNote } from "./review-notes-plugin";
import { usePlacement } from "../../engine/controls/usePlacement";
import "./ReviewMargin.css";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import { type ReviewMarginLabels } from "./margin-layout";

import { cardStyle, cutClass, useCardBox, type CardPlace } from "./MarginCards";

/** A review note's card in the margin, its mark and body, and its popover. */

export const NoteCard = memo(function NoteCard({
  itemKey,
  note,
  hot,
  picked,
  onPick,
  open,
  onOpen,
  cut,
  chip,
  labels,
  top,
  left,
  onHot,
  onDone,
  onAsk,
  onEdit,
  onHeight,
}: CardPlace & {
  itemKey: string;
  note: ReviewNote;
  /** Picked on the notes bar, or null while not picking. */
  picked: boolean | null;
  onPick: (id: string) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onEdit: (note: ReviewNote) => void;
}) {
  const ref = useCardBox(itemKey, top, onHeight, cut !== null);
  return (
    <div
      ref={ref}
      className={`review-note${hot ? " review-note-hot" : ""}${cutClass(cut, chip, open)}`}
      style={cardStyle(top, left, cut, open)}
      data-note={note.id}
      onMouseEnter={() => onHot(itemKey, true)}
      onMouseLeave={() => onHot(itemKey, false)}
      // Picking, the whole card picks it; else a click selects it, its own
      // buttons aside.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (picked !== null) onPick(note.id);
        else onOpen(itemKey);
      }}
    >
      {picked !== null && (
        <input
          type="checkbox"
          className="ui-check review-note-pick"
          checked={picked}
          aria-label={labels.reviewNotesPickOne}
          onChange={() => onPick(note.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {chip && !open ? (
        <>
          <div className="review-note-by">
            <NoteMark note={note} labels={labels} />
            {note.by === "me" ? labels.ownNoteBy : labels.reviewNoteBy}
          </div>
          <div className="tx-truncate review-note-chip-text">
            <InlineMarkdownText text={note.comment} />
          </div>
        </>
      ) : (
        <NoteBody
          note={note}
          labels={labels}
          onAsk={onAsk}
          onEdit={onEdit}
          onDone={onDone}
        />
      )}
    </div>
  );
});

/** Who wrote a note: Me for the writer's own, else the AI note's number. */
function NoteMark({
  note,
  labels,
}: {
  note: ReviewNote;
  labels: ReviewMarginLabels;
}) {
  return note.by === "me" ? (
    <span className="review-note-mark review-note-mark-me" aria-hidden="true">
      {labels.ownNoteMark}
    </span>
  ) : (
    <span className="review-note-num" aria-hidden="true">
      {note.num}
    </span>
  );
}

/** A note's card: who wrote it, the note, and its actions, in the margin
 *  and in the popover its badge opens. */
function NoteBody({
  note,
  labels,
  onAsk,
  onEdit,
  onDone,
}: {
  note: ReviewNote;
  labels: ReviewMarginLabels;
  onAsk: (note: ReviewNote) => void;
  onEdit: (note: ReviewNote) => void;
  onDone: (id: string) => void;
}) {
  return (
    <>
      <div className="review-note-by">
        <NoteMark note={note} labels={labels} />
        {note.by === "me" ? labels.ownNoteBy : labels.reviewNoteBy}
      </div>
      <div className="review-note-text">
        <InlineMarkdownText text={note.comment} />
      </div>
      <div className="review-note-actions">
        <button type="button" onClick={() => onAsk(note)}>
          {labels.reviewNoteAsk}
        </button>
        {note.by === "me" && (
          <button type="button" onClick={() => onEdit(note)}>
            {labels.ownNoteEdit}
          </button>
        )}
        <button type="button" onClick={() => onDone(note.id)}>
          {note.by === "me" ? labels.ownNoteDelete : labels.reviewNoteDone}
        </button>
      </div>
    </>
  );
}

/** Compact mode: a note opened from its badge, as a small floating card
 *  under it. */
export function NotePopover({
  note,
  x,
  y,
  labels,
  onDone,
  onAsk,
  onEdit,
  onClose,
}: {
  note: ReviewNote;
  x: number;
  y: number;
  labels: ReviewMarginLabels;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onEdit: (note: ReviewNote) => void;
  onClose: () => void;
}) {
  // A click outside it, or on another badge, or Escape closes it.
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    onClose,
    true,
    true,
    ".review-badge",
  );
  // Kept within the document's column, off the AI panel.
  const pos = usePlacement(ref, x, y, {
    right: () =>
      tabElement()
        ?.querySelector(":scope > .editor-scroll")
        ?.getBoundingClientRect().right,
  });
  return createPortal(
    <div
      ref={ref}
      className="review-note review-note-popover floating-surface"
      style={pos}
      role="dialog"
      aria-label={labels.reviewNoteBy}
    >
      <NoteBody
        note={note}
        labels={labels}
        onAsk={onAsk}
        onEdit={onEdit}
        onDone={onDone}
      />
    </div>,
    document.body,
  );
}
