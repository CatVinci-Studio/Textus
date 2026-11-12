import { useConversationGuard } from "../ai/chat/useConversationGuard";
import { useEffect, useRef } from "react";
import { useEditorProposals } from "./useEditorProposals";
import { useChatContextBridge } from "./useChatContextBridge";
import { usePanelSelection } from "./usePanelSelection";
import { useChatSelectionHighlight } from "./useChatSelectionHighlight";
import { useQuickAskReview } from "./useQuickAskReview";
import { useQuickAskControls } from "./useQuickAskControls";
import { useHeldWhileBusy } from "./useHeldWhileBusy";
import type { EditorSetup } from "./useEditorSetup";
import type { SelectionChipHandlers } from "../ai/chat/ChatComposer";
import { useAgentPanel } from "../ai/chat/panel/agent-panel";
import { useRevisionLearning } from "../ai/revision/RevisionLearning";
import type { Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import { AGENT_TABS_EVENT } from "../utils/events";

/**
 * One tab's editor and Textus AI's chats: their proposals, what each chat
 * is told of the document, the quoted selection, and the docked panel.
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
  useHeldWhileBusy({
    tabId: setup.tabId,
    quickAsk: quickConversation,
    quickAskOpen: inlineChat.visible,
    writing: conversation.busy,
    statuses: pendingEdits.allStatuses,
  });
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

  // The AI's panel shows, with this document the one in front.
  const agentPanel = useAgentPanel();
  const panelShown = isActive && agentPanel.shown;
  // The panel, or the detached window while this is the tab it shows.
  const chatTracking = panelShown || (detachedChatLabel !== null && isActive);
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

  // A new selection becomes a new chip in the detached window and the panel.
  // Read once the transaction is in: the listener runs before the view holds
  // the new selection, so the chip would lag one behind.
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

  // Only the active tab reports statuses, or every hidden tab broadcasts
  // and the last one wins.
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
    agentPanel,
  });

  // A new or reopened panel conversation waits while proposals are still
  // undecided.
  const panelGuard = useConversationGuard(pendingEdits.decidable.length);
  function startPanelConversation() {
    panelGuard.guard(() => conversation.reset());
  }

  function popOutPanel() {
    handleDetachChat();
    agentPanel.setOpen(false);
  }

  // The AI island's row of conversations asks the editor on screen.
  const actions = useRef({ startPanelConversation });
  actions.current = { startPanelConversation };
  useEffect(() => {
    if (!isActive) return;
    const onAsk = (e: Event) => {
      if ((e as CustomEvent<"new">).detail === "new")
        actions.current.startPanelConversation();
    };
    window.addEventListener(AGENT_TABS_EVENT, onAsk);
    return () => window.removeEventListener(AGENT_TABS_EVENT, onAsk);
  }, [isActive]);

  return {
    learning,
    proposals,
    pendingEdits,
    conversation,
    quickConversation,
    bridge,
    agentPanel,
    panelShown,
    panelSelection,
    quickChipHandlers,
    panelChipHandlers,
    review,
    controls,
    panelGuard,
    startPanelConversation,
    popOutPanel,
  };
}

export type EditorChat = ReturnType<typeof useEditorChat>;
