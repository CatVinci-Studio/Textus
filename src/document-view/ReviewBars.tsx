import { createPortal } from "react-dom";
import { useSettings } from "../prefs/SettingsContext";
import { Presence } from "../ui/usePresence";
import { ReviewBar } from "../ai/revision/ReviewBar";
import {
  addsTextOnly,
  revisionDisplayName,
} from "../ai/revision/revision-display";
import { NotesBar } from "../ai/margin/NotesBar";
import type { usePendingEdits } from "../ai/revision/usePendingEdits";
import type { NotesBarState } from "../ai/margin/useNotesBar";

/** The writer's own tracked changes, for the review bar while no AI edits
 *  are pending. */
export interface OwnReview {
  stops: number;
  position: number;
  /** Some change only adds text, which stays in the text in every view. */
  newText: boolean;
  step: (by: 1 | -1) => void;
  acceptAll: () => void;
  rejectAll: () => void;
}

/**
 * The bars over the bottom of the document: the review bar while edits are
 * pending (the AI's, else the writer's own), and the notes bar above it
 * while there are review notes.
 */
export function ReviewBars({
  paneEl,
  reviewBarShown,
  notesShown,
  phone,
  noMargin,
  pendingEdits,
  notes,
  stepReview,
  onOpenChat,
  own,
}: {
  paneEl: HTMLElement | null;
  reviewBarShown: boolean;
  notesShown: boolean;
  phone: boolean;
  /** Notes behind badges: no cards to pick them on. */
  noMargin: boolean;
  pendingEdits: ReturnType<typeof usePendingEdits>;
  notes: NotesBarState;
  stepReview: (by: 1 | -1) => void;
  onOpenChat: () => void;
  own: OwnReview | null;
}) {
  const { t, settings, setSettings } = useSettings();
  if (!paneEl) return null;
  return createPortal(
    <>
      <Presence show={reviewBarShown} exitMs={200}>
        {reviewBarShown && (
          <ReviewBar
            labels={t}
            taken={pendingEdits.reviewCount.taken}
            total={pendingEdits.reviewCount.total}
            position={pendingEdits.stopIndex}
            stops={pendingEdits.reviewStops.length}
            phone={phone}
            onPrevious={() => stepReview(-1)}
            onNext={() => stepReview(1)}
            onAccept={pendingEdits.acceptAll}
            onReject={pendingEdits.rejectAll}
            onOpenChat={onOpenChat}
            display={settings.revisionDisplay}
            displayName={(mode) => revisionDisplayName(t, mode)}
            onDisplay={(mode) => setSettings({ revisionDisplay: mode })}
            newText={pendingEdits.decidable.some((p) =>
              addsTextOnly(p.proposal),
            )}
            streaming={pendingEdits.reviewStreaming}
            painting={pendingEdits.picturesPainting}
          />
        )}
      </Presence>
      <Presence show={!!own} exitMs={200}>
        {own && (
          <ReviewBar
            labels={t}
            taken={own.stops}
            total={own.stops}
            position={own.position}
            stops={own.stops}
            phone={phone}
            onPrevious={() => own.step(-1)}
            onNext={() => own.step(1)}
            onAccept={own.acceptAll}
            onReject={own.rejectAll}
            display={settings.revisionDisplay}
            displayName={(mode) => revisionDisplayName(t, mode)}
            onDisplay={(mode) => setSettings({ revisionDisplay: mode })}
            newText={own.newText}
            streaming={false}
            painting={false}
          />
        )}
      </Presence>
      <Presence show={notesShown} exitMs={200}>
        {notesShown && (
          <NotesBar
            bar={notes}
            labels={t}
            raised={reviewBarShown || !!own}
            canPick={!noMargin}
          />
        )}
      </Presence>
    </>,
    paneEl,
  );
}
