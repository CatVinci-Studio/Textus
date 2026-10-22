import type { MessageQueueLabels } from "./MessageQueue";
import type { AgentConversation } from "./useAgentConversation";
import type { AgentMode } from "../../settings/SettingsContext";
import type { PendingStatus } from "../revision/usePendingEdits";
import type { AgentTurn, EditProposal } from "../types";
import type { ChatMessagesLabels, ChatMessagesProps } from "./ChatMessages";
import type { ChatComposerLabels, SelectionChipHandlers } from "./ChatComposer";
import type { QuickAskPendingBarLabels } from "./quick-ask/QuickAskPendingBar";
import { isProposalTool, parseToolProposal } from "./proposal";
import { refusedProposalIds } from "../revision/proposal-status";

/**
 * What the chat body is given (ChatBody.tsx) - its labels, the
 * conversation, the proposal callbacks - and what it reads from the turns:
 * the proposals in them and whether Quick Ask's answer shows whole.
 */

export interface ChatBodyLabels
  extends
    ChatMessagesLabels,
    ChatComposerLabels,
    QuickAskPendingBarLabels,
    MessageQueueLabels {
  /** Sent as the user's message when relocating a stale proposal. */
  relocateRequest: string;
  /** Pinned pending-edits bar (full/window variant only); "{n}" is how many
   *  are undecided. */
  pendingSummary: string;
  pendingReveal: string;
  expandInline: string;
  collapseInline: string;
}

export interface ChatBodyProps {
  /** Document as markdown source - what the request is sent with. */
  document: string;
  /** Selection as plain text (composer chip) and as markdown (what the model
   *  is actually shown, so formatting survives - see doc-markdown.ts). */
  selectedText: string | null;
  selectionMarkdown: string | null;
  /** The selection is one picture, said by a caller that has no Markdown
   *  for it yet (the docked panel serializes at send). */
  selectionIsPicture?: boolean;
  docPath: string | null;
  /** Explicit agent workspace root, or null for the document's own folder. */
  workspaceRoot: string | null;
  conversation: AgentConversation;
  defaultMode: AgentMode;
  /** The tour's lesson's mode - see ChatComposer. */
  tourMode?: AgentMode | null;
  defaultWebSearch: boolean;
  /** A message went out through a skill - see ChatComposer. */
  onSkillUsed?: () => void;
  labels: ChatBodyLabels;
  proposalStatus: (callId: string) => PendingStatus;
  pendingCount: number;
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  onAcceptProposal: (callId: string, text?: string) => void;
  /** See ChatMessages' proposalSentences, onDecideSentence and
   *  onRevealProposal - the card's view of the in-text decisions. */
  proposalSentences?: ChatMessagesProps["proposalSentences"];
  onDecideSentence?: ChatMessagesProps["onDecideSentence"];
  onRevealProposal?: ChatMessagesProps["onRevealProposal"];
  /** False where the editor's own review bar decides pending edits (the
   *  docked panel): the bar above the composer is then not drawn. */
  pendingBar?: boolean;
  /** See ChatMessages' onLocateText. */
  onLocateText?: (anchor: string, context?: string) => void;
  /** See ChatMessages' noteNumber. */
  noteNumber?: (callId: string) => number | null;
  onRejectProposal: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** Escape from the composer. The popup closes; a detached window doesn't
   *  (Escape shouldn't destroy an OS window the user placed deliberately). */
  onEscape?: () => void;
  /** The composer's mode, now and on every switch (ChatComposer). */
  onModeChange?: (mode: AgentMode) => void;
  /** Rendered above the composer - the popup's close-confirmation bar. */
  footer?: React.ReactNode;
  /** Jumps the editor to a pending edit. Absent in the detached window,
   *  which can't scroll another window's document. */
  onRevealPending?: () => void;
  /** The chat has a fixed height to fill (a resized panel, or a window), so
   *  the message list renders even while empty - it is the flexible region,
   *  and without it the composer would sit at the top of a blank panel. */
  fillHeight?: boolean;
  /** "quick" (the in-document Quick Ask bar) renders NO conversation - just
   *  a one-line reply summary, the pending bar, and the composer. Edits are
   *  the output; reading happens in the detached window ("full", default). */
  variant?: "quick" | "full";
  /** Detached window only: fetches the editor's document and selection as
   *  they read at this instant, immediately before a send.
   *
   *  The window is the cross-file surface, so it must not send against
   *  whatever was last pushed to it - the user may have typed, or moved to
   *  another file, since. Pulling once per send is exact and costs nothing
   *  in between; keeping a pushed copy fresh would mean re-serializing the
   *  whole document on every keystroke. Resolves null if the editor doesn't
   *  answer, in which case the last pushed context is used. */
  refreshContext?: () => Promise<{
    document: string;
    selectionMarkdown: string | null;
    /** Text around the caret when nothing is selected (cursorBlock). */
    cursor?: { before: string; after: string } | null;
    /** Heading of the section being worked in (AgentRequestOptions). */
    focusHeading?: string | null;
  } | null>;
  /** Quick variant only: the "review one at a time" nav bar's state/actions
   *  (usePendingEdits' focus* API), as one required-together object -
   *  without it the quick variant renders no pending bar at all, rather
   *  than a bar whose buttons silently do nothing. */
  quickReview?: QuickReview;
  /** Quick variant docked on a phone: the panel's own controls, shown in
   *  the composer's top row (ChatComposer's `dockActions`). */
  dockActions?: React.ReactNode;
  /** See ChatComposer's selectionChip. */
  selectionChip?: SelectionChipHandlers;
}

/** The Quick Ask nav bar's whole contract - see ChatBodyProps.quickReview. */
export interface QuickReview {
  /** 0-based position of the currently focused edit, or -1 if none. */
  focusIndex: number;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  onAcceptFocused: () => void;
  onRejectFocused: () => void;
}

/**
 * The chat itself: turn list, proposal cards, composer, and the send
 * orchestration around them - everything that is the same whether the chat is
 * an embedded popup or its own window.
 *
 * It deliberately owns no document state and applies nothing. Proposals go
 * out through `onProposals` and accept/reject go out through their callbacks,
 * so the embedded case can call usePendingEdits directly while the detached
 * case forwards the identical calls to the editor window over the bridge.
 * Neither path has its own copy of the apply logic.
 */
/** The propose_edit tool calls in `turns`, parsed - what `onProposals`
 *  consumers (usePendingEdits directly, or the detached-window bridge)
 *  expect. Shared by the settled afterSend path and the live streamed-turn
 *  path so the two can't drift. */
export function proposalsFromTurns(turns: AgentTurn[]) {
  const refused = refusedProposalIds(turns);
  return turns.flatMap((turn) => {
    if (turn.kind !== "ToolCall" || !isProposalTool(turn.name)) return [];
    if (refused.has(turn.call_id)) return [];
    const proposal = parseToolProposal(turn.name, turn.arguments);
    return proposal ? [{ callId: turn.call_id, proposal }] : [];
  });
}

/** The newest exchange: the last user message and every turn after it. */
export function lastExchange(history: AgentTurn[]): {
  prompt: string | null;
  turns: AgentTurn[];
} {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn.kind === "User") {
      return { prompt: turn.text, turns: history.slice(i + 1) };
    }
  }
  return { prompt: null, turns: history };
}

/**
 * Whether the quick panel shows a finished exchange in full. A reply that
 * only answers opens expanded - the answer IS the result, and a five-line
 * clamp hid most of it. A reply that proposed edits stays compact: the
 * edits in the document are the result, and the pending bar is where they
 * are decided.
 */
export function quickReplyExpands(history: AgentTurn[]): boolean {
  const { turns } = lastExchange(history);
  const answered = turns.some(
    (turn) => turn.kind === "Assistant" && turn.text.trim().length > 0,
  );
  return answered && proposalsFromTurns(turns).length === 0;
}
