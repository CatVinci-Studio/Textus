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

/** The document's proposals, learning from what is decided, and the tab
 *  held while the AI writes in it. */
function useDocumentProposals({
  setup,
  filePath,
  isActive,
  settings,
}: {
  setup: EditorSetup;
  filePath: string | null;
  isActive: boolean;
  settings: Settings;
}) {
  const learning = useRevisionLearning({
    docPath: filePath,
    settingsRef: setup.settingsRef,
  });
  const proposals = useEditorProposals({
    run: setup.run,
    pendingEditActionsRef: setup.pendingEditActionsRef,
    settingsRef: setup.settingsRef,
    settings,
    filePath,
    isActive,
    onDecided: learning.record,
    requestImageName: setup.imageName.requestImageName,
    textOf: setup.reporting.textOf,
  });
  const { pendingEdits, conversation, quickConversation } = proposals;
  useHeldWhileBusy({
    tabId: setup.tabId,
    quickAsk: quickConversation,
    quickAskOpen: setup.inlineChat.visible,
    writing: conversation.busy,
    statuses: pendingEdits.allStatuses,
    filePath,
  });
  return { learning, proposals };
}

/** The selection the panel (or detached window) tracks, and the
 *  highlights of the chips that stand for it. */
function useChatSelection(
  run: EditorSetup["run"],
  inlineChat: EditorSetup["inlineChat"],
  chatTracking: boolean,
) {
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
  return {
    panelSelection,
    updatePanelSelection,
    quickChipHandlers,
    panelChipHandlers,
  };
}

/** What the chat is told as this tab changes: the document it points at,
 *  and the statuses of the proposals in it. */
function useChatPushes({
  bridge,
  isActive,
  filePath,
  statuses,
}: {
  bridge: ReturnType<typeof useChatContextBridge>;
  isActive: boolean;
  filePath: string | null;
  statuses: Parameters<
    ReturnType<typeof useChatContextBridge>["pushChatStatuses"]
  >[0];
}) {
  const { detachedChatLabel, pushChatStatuses, forcePushLiveContext } = bridge;
  // Becoming the active tab, or saving under a new path, re-points the chat
  // at this document.
  useEffect(() => {
    forcePushLiveContext();
  }, [forcePushLiveContext, isActive, filePath]);

  // Only the active tab reports statuses, or every hidden tab broadcasts
  // and the last one wins.
  useEffect(() => {
    if (detachedChatLabel && isActive) pushChatStatuses(statuses);
  }, [detachedChatLabel, isActive, pushChatStatuses, statuses]);
}

/** Quick Ask's review steps over the pending edits, and its controls. */
function useQuickAsk(
  opts: Parameters<typeof useQuickAskReview>[0] &
    Parameters<typeof useQuickAskControls>[0],
) {
  const review = useQuickAskReview(opts);
  const controls = useQuickAskControls(opts);
  return { review, controls };
}

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
  const { learning, proposals } = useDocumentProposals({
    setup,
    filePath,
    isActive,
    settings,
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
  const { detachedChatLabel, pushLiveContext, handleDetachChat } = bridge;

  // The AI's panel shows, with this document the one in front.
  const agentPanel = useAgentPanel();
  const panelShown = isActive && agentPanel.shown;
  // The panel, or the detached window while this is the tab it shows.
  const chatTracking = panelShown || (detachedChatLabel !== null && isActive);
  const {
    panelSelection,
    updatePanelSelection,
    quickChipHandlers,
    panelChipHandlers,
  } = useChatSelection(run, inlineChat, chatTracking);
  windowChipRef.current = panelChipHandlers;

  // A new selection becomes a new chip in the detached window and the
  // panel, and a caret in an underline opens its card. Read once the
  // transaction is in: the listener runs before the view holds the new
  // selection, so they would lag one behind.
  setup.onSelectionChangeRef.current = () => {
    queueMicrotask(() => {
      pushLiveContext();
      updatePanelSelection();
      setup.grammarCaretRef.current();
    });
  };

  useChatPushes({
    bridge,
    isActive,
    filePath,
    statuses: pendingEdits.allStatuses,
  });

  const { review, controls } = useQuickAsk({
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

  return {
    workspaceRoot: proposals.workspaceRoot,
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
