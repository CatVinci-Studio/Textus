import { useEffect, useRef, useState } from "react";
import { useEditorProposals } from "./useEditorProposals";
import { useChatContextBridge } from "./useChatContextBridge";
import { usePanelSelection } from "./usePanelSelection";
import { useChatSelectionHighlight } from "./useChatSelectionHighlight";
import { useQuickAskReview } from "./useQuickAskReview";
import { useQuickAskControls } from "./useQuickAskControls";
import type { EditorSetup } from "./useEditorSetup";
import type { SelectionChipHandlers } from "../ai/chat/ChatComposer";
import { useAgentPanel } from "../ai/chat/panel/agent-panel";
import { useRevisionLearning } from "../ai/revision/RevisionLearning";
import type { Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";

/**
 * One tab's editor and Textus AI's chats: the proposals they make and how
 * they are decided, what each chat is told of the document (the docked
 * panel, the detached window, Quick Ask), the selection they quote, and
 * the docked panel's own state.
 */
export function useEditorChat({
  setup,
  filePath,
  docTitle,
  isActive,
  phone,
  settings,
  t,
}: {
  setup: EditorSetup;
  filePath: string | null;
  docTitle: string;
  isActive: boolean;
  phone: boolean;
  settings: Settings;
  t: Strings;
}) {
  const { run, inlineChat } = setup;
  const learning = useRevisionLearning({
    docPath: filePath,
    workspaceRoot: settings.agentWorkspaceRoot || null,
  });
  const proposals = useEditorProposals({
    run,
    pendingEditActionsRef: setup.pendingEditActionsRef,
    settingsRef: setup.settingsRef,
    settings,
    filePath,
    isActive,
    onDecided: learning.record,
    requestImageName: setup.imageName.requestImageName,
  });
  const { pendingEdits, conversation, quickConversation } = proposals;
  const windowChipRef = useRef<SelectionChipHandlers | null>(null);

  const bridge = useChatContextBridge({
    run,
    inlineChat,
    proposals,
    filePath,
    docTitle,
    filePathRef: setup.filePathRef,
    docTitleRef: setup.docTitleRef,
    isActiveRef: setup.isActiveRef,
    settings,
    t,
    selectionChip: windowChipRef,
  });
  const {
    detachedChatLabel,
    pushChatStatuses,
    pushLiveContext,
    forcePushLiveContext,
    handleDetachChat,
  } = bridge;

  // The docked panel (ai/chat/panel/agent-panel.tsx): rendered by THIS editor only
  // while it is the active tab and the panel is open.
  const agentPanel = useAgentPanel();
  const panelContainer = isActive ? agentPanel.container : null;
  // The panel, or the detached window while this is the tab it shows.
  const chatTracking =
    panelContainer !== null || (detachedChatLabel !== null && isActive);
  const { panelSelection, updatePanelSelection } = usePanelSelection(
    run,
    chatTracking,
  );
  const { quickChipHandlers, panelChipHandlers } = useChatSelectionHighlight({
    run,
    inlineChat,
    panelRange: panelSelection?.range ?? null,
    tracking: chatTracking,
  });
  windowChipRef.current = panelChipHandlers;

  // A new selection becomes a new chip in the detached window and the
  // panel - "re-drag to highlight and it goes in" is the behaviour that
  // separates those surfaces from the in-document Quick Ask bar.
  // Read once the transaction is in: the listener runs while it is being
  // applied, before the view holds the new selection, and both read the
  // view - the chip lagged a selection behind, and stayed away after a
  // triple-click until the next transaction.
  setup.onSelectionChangeRef.current = () => {
    queueMicrotask(() => {
      pushLiveContext();
      updatePanelSelection();
    });
    setup.grammarCaretRef.current();
  };

  // Becoming the active tab, or saving under a new path, re-points the chat
  // at this document.
  useEffect(() => {
    forcePushLiveContext();
  }, [forcePushLiveContext, isActive, filePath]);

  // Only the active tab reports statuses, for the same reason it is the only
  // one that pushes context: otherwise every hidden tab broadcasts its own
  // and whichever rendered last wins.
  useEffect(() => {
    if (detachedChatLabel && isActive)
      pushChatStatuses(pendingEdits.allStatuses);
  }, [detachedChatLabel, isActive, pushChatStatuses, pendingEdits.allStatuses]);

  const review = useQuickAskReview({
    run,
    pendingEdits,
    inlineChat,
    phone,
    isActive,
  });

  const controls = useQuickAskControls({
    run,
    inlineChat,
    pendingEdits,
    conversation,
    quickConversation,
    quickAskEl: setup.quickAskEl,
    phone,
    isActive,
    settings,
    agentPanel,
    handleDetachChat,
  });

  // A new panel conversation waits while proposals are still undecided.
  const decidableCount = pendingEdits.decidable.length;
  const [panelGuard, setPanelGuard] = useState(false);
  useEffect(() => {
    if (decidableCount === 0) setPanelGuard(false);
  }, [decidableCount]);
  function startPanelConversation() {
    if (pendingEdits.decidable.length > 0) {
      setPanelGuard(true);
      return;
    }
    setPanelGuard(false);
    conversation.reset();
  }

  function popOutPanel() {
    handleDetachChat();
    agentPanel.setOpen(false);
  }

  return {
    learning,
    proposals,
    pendingEdits,
    conversation,
    quickConversation,
    bridge,
    agentPanel,
    panelContainer,
    panelSelection,
    quickChipHandlers,
    panelChipHandlers,
    review,
    controls,
    panelGuard,
    setPanelGuard,
    startPanelConversation,
    popOutPanel,
  };
}

export type EditorChat = ReturnType<typeof useEditorChat>;
