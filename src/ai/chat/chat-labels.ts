import { plural, type Lang, type Strings } from "../../i18n/strings";
import type { InlineChatLabels } from "./quick-ask/InlineChat";
import { pickerLabels } from "./ComposerPicker";

/**
 * The chat's user-facing strings, assembled once here rather than inline at
 * each mount point - the embedded Quick Ask bar (MilkdownEditor) and the
 * detached window (ChatWindowApp) render the same components and so need
 * exactly the same set, and a second hand-written copy would go stale the
 * first time a label was added. `lang` is the language `t` is in, which
 * picks the plural forms of the counts.
 */
export function chatLabels(t: Strings, lang: Lang): InlineChatLabels {
  return {
    placeholder: t.agentInputPlaceholder,
    picker: pickerLabels(t, lang),
    send: t.agentSend,
    stop: t.agentStop,
    retry: t.agentRetry,
    thinking: t.agentThinking,
    attachFile: t.agentAttachFile,
    attachmentTruncated: t.chatAttachmentTruncated,
    attachmentNoVision: t.chatAttachmentNoVision,
    selectedChars: (n) => plural(t.chatSelectedChars, n, lang),
    selectionChip: (n) => plural(t.chatSelectionChip, n, lang),
    proposalTitle: t.agentProposalTitle,
    proposalStatus: {
      streaming: t.proposalStatusStreaming,
      accepted: t.proposalStatusAccepted,
      rejected: t.proposalStatusRejected,
      invalid: t.proposalStatusInvalid,
      expired: t.proposalStatusExpired,
    },
    proposalAccept: t.proposalAccept,
    proposalReject: t.proposalReject,
    proposalAcceptAll: t.proposalAcceptAll,
    proposalRejectAll: t.proposalRejectAll,
    proposalRelocate: t.proposalRelocate,
    proposalChangeCount: t.proposalChangeCount,
    proposalTakeSentence: t.proposalTakeSentence,
    proposalKeepSentence: t.proposalKeepSentence,
    proposalShowInText: t.proposalShowInText,
    proposalAcceptSome: t.proposalAcceptSome,
    commentTitle: t.reviewNoteBy,
    commentLocate: t.proposalShowInText,
    memorySaved: t.memoryChipSaved,
    memoryScopeProject: t.memoryScopeProject,
    memoryScopePersonal: t.memoryScopePersonal,
    memoryUndo: t.memoryChipUndo,
    memoryMakePersonal: t.memoryMakePersonal,
    memoryMakeProject: t.memoryMakeProject,
    memoryUndone: t.memoryChipUndone,
    memoryActionFailed: t.memoryActionFailed,
    toolResult: t.toolResult,
    aiErrors: {
      notConfigured: t.aiErrorNotConfigured,
      auth: t.aiErrorAuth,
      workspaceKey: t.aiErrorWorkspaceKey,
      rateLimit: t.aiErrorRateLimit,
      server: t.aiErrorServer,
      timeout: t.aiErrorTimeout,
      network: t.aiErrorNetwork,
      model: t.aiErrorModel,
    },
    toolActivity: {
      search_document: t.toolSearchDocument,
      read_document: t.toolReadDocument,
      // No heading named: the whole document, not an empty quote.
      "read_document:whole": t.toolReadWholeDocument,
      search_files: t.toolSearchFiles,
      list_files: t.toolListFiles,
      read_file: t.toolReadFile,
      use_skill: t.toolUseSkill,
      add_comment: t.toolAddComment,
      check_conventions: t.toolCheckConventions,
      measure_text: t.toolMeasureText,
      remember: t.toolRemember,
      // Any tool without its own line: a word, not its internal name.
      "*": t.toolWorking,
      // The edit being written, in words: Quick Ask's status line showed
      // the raw "propose_edit…". The ellipsis is added after it.
      propose_edit: t.proposalStatusStreaming.replace(/…$/, ""),
    },
    diffCollapse: t.diffCollapse,
    diffShow: t.diffShow,
    pendingSummary: t.chatPendingSummary,
    pendingReveal: t.chatPendingReveal,
    quickAskPosition: t.quickAskPosition,
    quickAskPrevEdit: t.quickAskPrevEdit,
    quickAskNextEdit: t.quickAskNextEdit,
    quickAskAcceptAllCount: t.quickAskAcceptAllCount,
    quickAskRejectAllCount: t.quickAskRejectAllCount,
    dropSelection: t.chatDropSelection,
    atCursor: t.quickAskAtCursor,
    relocateRequest: t.proposalRelocateRequest,
    expandInline: t.chatExpandInline,
    collapseInline: t.chatCollapseInline,
    approvePlan: t.chatApprovePlan,
    executePlanRequest: t.chatExecutePlanRequest,
    modeAsk: t.agentModeAsk,
    modeEdit: t.agentModeEdit,
    modePlan: t.agentModePlan,
    modeLabel: t.chatModeLabel,
    webSearch: t.webSearchLabel,
    close: t.chatClose,
    detach: t.chatDetach,
    continueInPanel: t.chatContinueInPanel,
    newConversation: t.chatNewConversation,
    closeConfirm: t.chatCloseConfirm,
    closeConfirmAccept: t.chatCloseConfirmAccept,
    closeConfirmReject: t.chatCloseConfirmReject,
    closeConfirmCancel: t.chatCloseConfirmCancel,
    actionNames: {
      replace: t.agentActionReplace,
      replace_selection: t.agentActionReplaceSelection,
      insert_before: t.agentActionInsertBefore,
      insert_after: t.agentActionInsertAfter,
      delete: t.agentActionDelete,
      append: t.agentActionAppend,
      insert_at_cursor: t.agentActionInsertAtCursor,
    },
  };
}
