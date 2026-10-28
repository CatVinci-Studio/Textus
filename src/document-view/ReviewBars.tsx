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

/**
 * The bars over the bottom of the document: the review bar while edits are
 * pending, and the notes bar above it while there are review notes.
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
      <Presence show={notesShown} exitMs={200}>
        {notesShown && (
          <NotesBar
            bar={notes}
            labels={t}
            raised={reviewBarShown}
            canPick={!noMargin}
          />
        )}
      </Presence>
    </>,
    paneEl,
  );
}
