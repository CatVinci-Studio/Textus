import { useState } from "react";
import { createPortal } from "react-dom";
import { ReviewBars, type OwnReview } from "./ReviewBars";
import { OWN_CHANGES } from "../ai/margin/own-revision-plugin";
import type { EditorChat } from "./useEditorChat";
import type { EditorReview } from "./useEditorReview";
import { RevisionLearningBar } from "../ai/revision/RevisionLearning";
import { ReviewMargin } from "../ai/margin/ReviewMargin";
import { OpenReviewNote } from "../ai/margin/OpenReviewNote";
import type { Strings } from "../i18n/strings";

/** Beside and under one tab's text: the margin's cards (the AI's notes
 *  and changes, and the writer's own), a note opened from its badge, the
 *  review and notes bars, and what revision choices taught. */
export function EditorMarginLayer({
  chat,
  review,
  isActive,
  phone,
  quickAskVisible,
  t,
}: {
  chat: EditorChat;
  review: EditorReview;
  isActive: boolean;
  phone: boolean;
  quickAskVisible: boolean;
  t: Strings;
}) {
  const { notes, paneEl, scrollEl, contentEl, reviewBarShown } = review;
  const { pendingEdits, agentPanel } = chat;
  const changes = notes.revisions.changes ?? [];
  const ownKey = (i: number) => `rev:${OWN_CHANGES}:${changes[i].index}`;
  // The change stepped to; a card picked since points the bar there.
  const [stepped, setStepped] = useState(-1);
  const picked = changes.findIndex((_, i) => ownKey(i) === notes.focusedItem);
  const position =
    picked >= 0 ? picked : stepped < changes.length ? stepped : -1;
  const own: OwnReview | null =
    isActive &&
    !reviewBarShown &&
    !quickAskVisible &&
    !(phone && chat.panelContainer) &&
    changes.length > 0
      ? {
          stops: changes.length,
          position,
          newText: changes.some((c) => !c.before),
          step: (by) => {
            const next =
              position < 0
                ? by > 0
                  ? 0
                  : changes.length - 1
                : (position + by + changes.length) % changes.length;
            setStepped(next);
            notes.selectCard(ownKey(next));
          },
          acceptAll: notes.revisions.acceptAll,
          rejectAll: notes.revisions.rejectAll,
        }
      : null;
  return (
    <>
      {isActive && scrollEl && contentEl && (
        <ReviewMargin
          view={notes.editorView}
          items={notes.marginItems}
          hot={notes.hotNote}
          focused={notes.focusedItem}
          scrollEl={scrollEl}
          contentEl={contentEl}
          labels={t}
          onHot={notes.setNoteHot}
          onDone={notes.doneNote}
          onAsk={notes.askAboutNote}
          onEdit={notes.editNote}
          onDecide={notes.decide}
          onNoMargin={notes.onNoMargin}
          layoutKey={pendingEdits.previews}
          picked={notes.bar.picked}
          onPick={notes.bar.togglePick}
          onOpen={notes.selectCard}
        />
      )}
      <OpenReviewNote
        note={notes.openNoteData}
        at={notes.openNote}
        phone={phone}
        editorView={notes.editorView}
        t={t}
        onDone={notes.doneNote}
        onAsk={notes.askAboutNote}
        onEdit={notes.editNote}
        onClose={() => notes.setOpenNote(null)}
      />
      <ReviewBars
        paneEl={paneEl}
        reviewBarShown={reviewBarShown}
        notesShown={isActive && !phone && notes.notes.length > 0}
        phone={phone}
        noMargin={notes.noMargin}
        pendingEdits={pendingEdits}
        notes={notes.bar}
        stepReview={review.stepReview}
        onOpenChat={() => agentPanel.setOpen(true)}
        own={own}
      />
      {/* What revision choices taught, once the review is done. */}
      {paneEl &&
        isActive &&
        !reviewBarShown &&
        !own &&
        pendingEdits.reviewed.length === 0 &&
        !quickAskVisible &&
        !(phone && chat.panelContainer) &&
        createPortal(
          <RevisionLearningBar
            learning={chat.learning}
            labels={t}
            phone={phone}
          />,
          paneEl,
        )}
    </>
  );
}
