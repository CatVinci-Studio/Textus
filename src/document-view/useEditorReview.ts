import { useEditorPane, useReviewBar } from "./useReviewBar";
import { useIllustrateParagraph } from "./useIllustrateParagraph";
import { useTourSignals } from "./useTourSignals";
import type { EditorSetup } from "./useEditorSetup";
import type { EditorChat } from "./useEditorChat";
import type { EditorPopups } from "./useEditorPopups";
import { useRevisionAnnouncements } from "../ai/revision/useRevisionAnnouncements";
import { useReviewNotes } from "../ai/margin/useReviewNotes";
import type { Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";
import type { TourAi } from "../utils/events";

/**
 * Reviewing one tab's document: the review bar, announcements, the margin's
 * notes and changes, illustrating a paragraph, and the tour's signals.
 */
export function useEditorReview({
  setup,
  chat,
  popups,
  filePath,
  isActive,
  phone,
  settings,
  tour,
  t,
}: {
  setup: EditorSetup;
  chat: EditorChat;
  popups: EditorPopups;
  filePath: string | null;
  isActive: boolean;
  phone: boolean;
  settings: Settings;
  tour: TourAi | null;
  t: Strings;
}) {
  const { run, inlineChat } = setup;
  const { pendingEdits, conversation, quickConversation, agentPanel } = chat;
  const pane = useEditorPane();
  const bar = useReviewBar({
    run,
    pendingEdits,
    isActive,
    phone,
    quickAskVisible: inlineChat.visible,
    panelContainer: chat.panelContainer,
    agentPanel,
  });

  useRevisionAnnouncements({
    active: isActive,
    stops: pendingEdits.reviewStops.length,
    streaming: pendingEdits.reviewStreaming,
    position: pendingEdits.stopIndex,
    t,
    lang: settings.language,
  });

  const notes = useReviewNotes({
    run,
    reviewNotesRef: setup.reviewNotesRef,
    noMarginRef: setup.noMarginRef,
    conversation,
    quickConversation,
    pendingEdits,
    revisionDisplay: settings.revisionDisplay,
    agentPanel,
    t,
    showAiNotice: setup.notice.showAiNotice,
    filePath,
  });

  const { onSkillUsed } = useTourSignals({
    tour,
    grammarCardOpen: popups.grammar.popover !== null,
    undecidedRevisions: pendingEdits.decidable.length,
    reviewNotes: notes.notes.length,
    conversations: [conversation, quickConversation],
  });

  const illustrateParagraph = useIllustrateParagraph({
    run,
    proposals: chat.proposals,
    agentPanel,
    t,
  });

  return { ...pane, ...bar, notes, onSkillUsed, illustrateParagraph };
}

export type EditorReview = ReturnType<typeof useEditorReview>;
