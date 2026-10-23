import type { EditorView } from "@milkdown/kit/prose/view";
import { NotePopover } from "./ReviewMargin";
import type { ReviewNote } from "./review-notes-plugin";
import { BottomCard } from "../../ui/BottomCard";
import { Presence } from "../../ui/usePresence";
import type { Strings } from "../../i18n/strings";

/** A review note opened from its numbered badge (no room for a margin): a
 *  popover under the badge, or on a phone a card from the bottom. */
export function OpenReviewNote({
  note,
  at,
  phone,
  editorView,
  t,
  onDone,
  onAsk,
  onEdit,
  onClose,
}: {
  note: ReviewNote | null;
  /** Where the badge was; null while no note is open. */
  at: { x: number; y: number } | null;
  phone: boolean;
  editorView: EditorView | null;
  t: Strings;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onEdit: (note: ReviewNote) => void;
  onClose: () => void;
}) {
  const own = note?.by === "me";
  return (
    <>
      {note && at && !phone && (
        <NotePopover
          note={note}
          x={at.x}
          y={at.y}
          labels={t}
          onDone={onDone}
          onAsk={onAsk}
          onEdit={onEdit}
          onClose={onClose}
        />
      )}
      <Presence show={!!note && phone} exitMs={250}>
        {note && phone && (
          <BottomCard
            label={own ? t.ownNoteBy : t.reviewNoteBy}
            actions={[
              {
                label: t.reviewNoteAsk,
                onSelect: () => onAsk(note),
              },
              ...(own
                ? [{ label: t.ownNoteEdit, onSelect: () => onEdit(note) }]
                : []),
              {
                label: own ? t.ownNoteDelete : t.reviewNoteDone,
                primary: true,
                onSelect: () => onDone(note.id),
              },
            ]}
            onClose={onClose}
          >
            <div className="bottom-card-kicker">
              <span
                className={`review-note-mark${own ? " review-note-mark-me" : ""}`}
                aria-hidden="true"
              >
                {own ? t.ownNoteMark : "AI"}
              </span>
              {own ? t.ownNoteBy : t.reviewNoteBy}
            </div>
            <p className="bottom-card-quote">
              {editorView?.state.doc.textBetween(note.from, note.to, " ")}
            </p>
            {note.comment}
          </BottomCard>
        )}
      </Presence>
    </>
  );
}
