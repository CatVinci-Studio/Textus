import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../prefs/SettingsContext";
import { Presence } from "../engine/motion/usePresence";
import { ReviewBar, type BarChanges } from "../ai/revision/ReviewBar";
import { revisionDisplayName } from "../ai/revision/revision-display";
import type { usePendingEdits } from "../ai/revision/usePendingEdits";
import type { NotesBarState } from "../ai/margin/useNotesBar";

/** The writer's own tracked changes, for the bar while no AI edits are
 *  pending: where each is, and pointing at one. */
export interface OwnReview {
  froms: number[];
  position: number;
  pointAt: (index: number) => void;
  acceptAll: () => void;
  rejectAll: () => void;
}

/** One place the bar steps to: a change or a note, where it starts. */
interface Stop {
  key: string;
  from: number;
  go: () => void;
}

/**
 * The one bar over the bottom of the document while anything waits in it:
 * Textus AI's changes (else the writer's own) and the review notes, its ‹ ›
 * going through all of them in the document's order.
 */
export function ReviewBars({
  paneEl,
  reviewBarShown,
  notesShown,
  phone,
  noMargin,
  pendingEdits,
  notes,
  revealProposal,
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
  revealProposal: (callId: string, index: number) => void;
  onOpenChat: () => void;
  own: OwnReview | null;
}) {
  const { t, settings, setSettings } = useSettings();
  const view = {
    display: settings.revisionDisplay,
    displayName: (mode: BarChanges["display"]) => revisionDisplayName(t, mode),
    onDisplay: (mode: BarChanges["display"]) =>
      setSettings({ revisionDisplay: mode }),
  };
  const changes: BarChanges | null = reviewBarShown
    ? {
        ...view,
        taken: pendingEdits.reviewCount.taken,
        total: pendingEdits.reviewCount.total,
        onAccept: pendingEdits.acceptAll,
        onReject: pendingEdits.rejectAll,
        streaming: pendingEdits.reviewStreaming,
        painting: pendingEdits.picturesPainting,
      }
    : own
      ? {
          ...view,
          taken: own.froms.length,
          total: own.froms.length,
          onAccept: own.acceptAll,
          onReject: own.rejectAll,
          streaming: false,
          painting: false,
        }
      : null;
  const stops: Stop[] = [
    ...(reviewBarShown
      ? pendingEdits.reviewStops.map((s) => ({
          key: `ai:${s.callId}:${s.index}`,
          from: s.from,
          go: () => {
            notes.clearPointer();
            revealProposal(s.callId, s.index);
          },
        }))
      : []),
    ...(own && !reviewBarShown
      ? own.froms.map((from, i) => ({
          key: `own:${i}`,
          from,
          go: () => {
            notes.clearPointer();
            own.pointAt(i);
          },
        }))
      : []),
    ...(notesShown
      ? notes.ordered.map((note) => ({
          key: `note:${note.id}`,
          from: note.from,
          go: () => notes.pointAt(note.id),
        }))
      : []),
  ].sort((a, b) => a.from - b.from);

  // Where each kind's own pointer is: a card picked moves the bar there.
  const focused = [
    pendingEdits.focusedStop &&
      `ai:${pendingEdits.focusedStop.callId}:${pendingEdits.focusedStop.index}`,
    own && own.position >= 0 && `own:${own.position}`,
    notes.position >= 0 && `note:${notes.ordered[notes.position]?.id}`,
  ].filter((key): key is string => !!key);
  const [at, setAt] = useState<string | null>(null);
  const focusedKeys = focused.join("\n");
  useEffect(() => {
    const keys = focusedKeys ? focusedKeys.split("\n") : [];
    setAt((was) => (was && keys.includes(was) ? was : (keys.at(-1) ?? null)));
  }, [focusedKeys]);
  const position = stops.findIndex((s) => s.key === at);
  const step = (by: 1 | -1) => {
    if (!stops.length) return;
    const next =
      position < 0
        ? by > 0
          ? 0
          : stops.length - 1
        : (position + by + stops.length) % stops.length;
    stops[next]!.go();
    setAt(stops[next]!.key);
  };

  const shown = !!changes || notesShown;
  if (!paneEl) return null;
  return createPortal(
    <Presence show={shown}>
      {shown && (
        <ReviewBar
          labels={t}
          phone={phone}
          position={position}
          stops={stops.length}
          onPrevious={() => step(-1)}
          onNext={() => step(1)}
          changes={changes}
          notes={
            notesShown
              ? { count: notes.count, bar: notes, canPick: !noMargin }
              : null
          }
          onOpenChat={reviewBarShown ? onOpenChat : undefined}
        />
      )}
    </Presence>,
    paneEl,
  );
}
