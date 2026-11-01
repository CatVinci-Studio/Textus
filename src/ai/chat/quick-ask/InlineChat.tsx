import type { DocumentSnapshot } from "../../doc-markdown";
import { useRef } from "react";
import type { AgentConversation } from "../useAgentConversation";
import type { PendingStatus } from "../../revision/usePendingEdits";
import type { EditProposal } from "../../types";
import { ChatBody, type ChatBodyLabels } from "../ChatBody";
import type { SelectionChipHandlers } from "../ChatComposer";
import { CloseConfirmBar, type CloseConfirmLabels } from "../CloseConfirm";
import { useQuickAskReveal } from "./useQuickAskReveal";
import { useQuickAskDock } from "./quick-ask-dock";
import { CloseIcon, DetachIcon, PlusIcon } from "../../../ui/icons";
import type { AgentMode } from "../../../prefs/SettingsContext";
import "../AgentTurnView.css";
import "../inline-chat.css";
import { Tooltip } from "../../../ui/Tooltip";
import { isImeKeydown } from "../../../utils/ime";

export interface InlineChatLabels extends ChatBodyLabels, CloseConfirmLabels {
  /** Accessible name / tooltip of the header's close button. */
  close: string;
  /** Accessible name / tooltip of the pop-out-to-OS-window button. */
  detach: string;
  /** Quick Ask's header button: hand the exchange to the full conversation. */
  continueInPanel: string;
  newConversation: string;
}

interface InlineChatProps {
  document: DocumentSnapshot;
  /** The document and selection to send against, read at send time. */
  sendContext: () => Promise<{
    document: DocumentSnapshot;
    selectionMarkdown: string | null;
  } | null>;
  selectedText: string | null;
  selectionMarkdown: string | null;
  /** The document's path - resolves the agent workspace (skills, files). */
  docPath: string | null;
  /** Explicit agent workspace root, or null for the document's own folder. */
  workspaceRoot: string | null;
  /** Conversation state owned by the editor so close/reopen preserves it;
   *  only the explicit New Conversation action resets it. */
  conversation: AgentConversation;
  defaultMode: AgentMode;
  defaultWebSearch: boolean;
  /** The composer's selection chip handlers. */
  selectionChip?: SelectionChipHandlers;
  labels: InlineChatLabels;
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  /** Live status of a propose_edit call_id. */
  proposalStatus: (callId: string) => PendingStatus;
  onAcceptProposal: (callId: string) => void;
  onRejectProposal: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** How many proposals are currently decidable (streaming ones excluded).
   *  Drives the nav bar below. */
  pendingCount: number;
  /** 0-based position of the currently focused edit, or -1 if none. */
  focusIndex: number;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  onAcceptFocused: () => void;
  onRejectFocused: () => void;
  /** Pops the full conversation out into its own OS window. */
  onDetach: () => void;
  /** Close and New Conversation both go through the editor, which owns the
   *  pending-edits guard, so every entry point asks before discarding edits. */
  onNewConversation: () => void;
  onRequestClose: () => void;
  /** Set while that guard is asking; the bar's answer runs `onProceed`. */
  confirm: { onProceed: () => void; onCancel: () => void } | null;
  /** iPhone: docked at the bottom of the screen, above the keyboard, rather
   *  than a widget in the document. */
  docked?: boolean;
  /** Docked only: the panel's height changed (`first`: it just opened) -
   *  the editor keeps the passage being discussed in view above it. */
  onDockResize?: (first: boolean) => void;
}

/// Quick Ask, the in-document chat: a zone widget after the block it was
/// opened on (docked above the keyboard on an iPhone). This is only its
/// chrome; the body is ChatBody's "quick" variant.
export function InlineChat({
  document,
  sendContext,
  selectedText,
  selectionMarkdown,
  docPath,
  workspaceRoot,
  conversation,
  defaultMode,
  defaultWebSearch,
  selectionChip,
  labels,
  onProposals,
  proposalStatus,
  onAcceptProposal,
  onRejectProposal,
  onAcceptAll,
  onRejectAll,
  pendingCount,
  focusIndex,
  onFocusNext,
  onFocusPrevious,
  onAcceptFocused,
  onRejectFocused,
  onDetach,
  onNewConversation,
  onRequestClose,
  confirm,
  docked = false,
  onDockResize,
}: InlineChatProps) {
  // In the document flow the panel can open or grow below the fold with
  // nothing on screen to say so. (A docked panel is outside the scroll area.)
  const panelRef = useRef<HTMLDivElement>(null);
  useQuickAskReveal(panelRef);
  useQuickAskDock(panelRef, docked, onDockResize);

  const actions = (
    <>
      {/* Nothing to start over from on a fresh panel. */}
      {(conversation.history.length > 0 || conversation.busy) && (
        <Tooltip text={labels.newConversation}>
          <button
            type="button"
            className="inline-chat-header-button"
            aria-label={labels.newConversation}
            onClick={onNewConversation}
          >
            <PlusIcon />
          </button>
        </Tooltip>
      )}
      <Tooltip text={labels.continueInPanel}>
        <button
          type="button"
          className="inline-chat-header-button"
          aria-label={labels.continueInPanel}
          onClick={onDetach}
        >
          <DetachIcon />
        </button>
      </Tooltip>
      <Tooltip text={labels.close}>
        <button
          type="button"
          className="inline-chat-header-button inline-chat-close"
          aria-label={labels.close}
          onClick={onRequestClose}
        >
          <CloseIcon />
        </button>
      </Tooltip>
    </>
  );

  return (
    <div
      className={`inline-chat${docked ? " quick-ask-dock" : ""}`}
      ref={panelRef}
      // Escape anywhere in the panel - not only in the composer - asks to
      // close it. An IME composition owns its own Escape (cancel the
      // candidate), and a control that consumed the key says so.
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        if (isImeKeydown(e)) return;
        e.preventDefault();
        if (confirm) confirm.onCancel();
        else onRequestClose();
      }}
    >
      <div className="inline-chat-shell floating-surface">
        {/* Docked, the buttons share the composer's top row with the
            quoted selection instead of floating over the text. */}
        {!docked && (
          <div className="inline-chat-header">
            <div className="inline-chat-header-actions">{actions}</div>
          </div>
        )}
        <ChatBody
          document={document}
          refreshContext={sendContext}
          selectedText={selectedText}
          selectionMarkdown={selectionMarkdown}
          docPath={docPath}
          workspaceRoot={workspaceRoot}
          conversation={conversation}
          // Quick Ask has no Create: a default of Create starts in Write.
          defaultMode={defaultMode === "create" ? "write" : defaultMode}
          defaultWebSearch={defaultWebSearch}
          labels={labels}
          proposalStatus={proposalStatus}
          pendingCount={pendingCount}
          onProposals={onProposals}
          onAcceptProposal={onAcceptProposal}
          onRejectProposal={onRejectProposal}
          onAcceptAll={onAcceptAll}
          onRejectAll={onRejectAll}
          variant="quick"
          quickReview={{
            focusIndex,
            onFocusNext,
            onFocusPrevious,
            onAcceptFocused,
            onRejectFocused,
          }}
          dockActions={docked ? actions : undefined}
          selectionChip={selectionChip}
          footer={
            confirm && (
              <CloseConfirmBar
                labels={labels}
                pendingCount={pendingCount}
                onAcceptAll={onAcceptAll}
                onRejectAll={onRejectAll}
                onClose={confirm.onProceed}
                onCancel={confirm.onCancel}
              />
            )
          }
        />
      </div>
    </div>
  );
}
