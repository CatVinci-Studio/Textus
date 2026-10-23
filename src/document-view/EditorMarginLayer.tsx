import { createPortal } from "react-dom";
import { ReviewBars } from "./ReviewBars";
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
      />
      {/* What revision choices taught, once the review is done. */}
      {paneEl &&
        isActive &&
        !reviewBarShown &&
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
