import type { DocumentSnapshot } from "../doc-markdown";
import type { MessageQueueLabels } from "./MessageQueue";
import type { AgentConversation } from "./useAgentConversation";
import type { AgentMode, PanelMode } from "../../prefs/SettingsContext";
import type { PendingStatus } from "../revision/usePendingEdits";
import type { AgentTurn, EditProposal } from "../types";
import type { ChatMessagesLabels, ChatMessagesProps } from "./ChatMessages";
import type { ChatComposerLabels, SelectionChipHandlers } from "./ChatComposer";
import type { QuickAskPendingBarLabels } from "./quick-ask/QuickAskPendingBar";
import { isProposalTool, parseToolProposal } from "./proposal";
import { refusedProposalIds } from "../revision/proposal-status";

/** What the chat body is given, and what it reads from the turns. */

export interface ChatBodyLabels
  extends
    ChatMessagesLabels,
    ChatComposerLabels,
    QuickAskPendingBarLabels,
    MessageQueueLabels {
  /** Sent as the user's message when relocating a stale proposal. */
  relocateRequest: string;
  /** Sent as the user's message by Continue, after an exchange ran out of
   *  steps. */
  continueRequest: string;
  /** Pinned pending-edits bar (full/window variant only); "{n}" is how many
   *  are undecided. */
  pendingSummary: string;
  pendingReveal: string;
  expandInline: string;
  collapseInline: string;
}

export interface ChatBodyProps {
  /** Document as markdown source - what the request is sent with. */
  document: DocumentSnapshot;
  /** Selection as plain text (composer chip) and as markdown (what the model
   *  is shown, so formatting survives). */
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
  /** The tour's lesson's mode. */
  tourMode?: AgentMode | null;
  defaultWebSearch: boolean;
  labels: ChatBodyLabels;
  proposalStatus: (callId: string) => PendingStatus;
  pendingCount: number;
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  onAcceptProposal: (callId: string, text?: string) => void;
  /** The card's view of the in-text decisions. */
  proposalSentences?: ChatMessagesProps["proposalSentences"];
  onDecideSentence?: ChatMessagesProps["onDecideSentence"];
  onRevealProposal?: ChatMessagesProps["onRevealProposal"];
  /** False where the editor's own review bar decides pending edits (the
   *  docked panel): the bar above the composer is then not drawn. */
  pendingBar?: boolean;
  onLocateText?: (anchor: string, block?: string) => void;
  noteNumber?: (callId: string) => number | null;
  onRejectProposal: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** Escape from the composer. The popup closes; a detached window doesn't
   *  (Escape shouldn't destroy an OS window the user placed deliberately). */
  onEscape?: () => void;
  /** The composer's mode, now and on every switch. */
  onModeChange?: (mode: PanelMode) => void;
  /** The panel: Research is offered, its message a paper's topic. */
  onResearch?: (topic: string) => void;
  /** Research mode's choices, in the composer's toolbar. */
  researchControls?: React.ReactNode;
  /** Rendered above the composer - the popup's close-confirmation bar. */
  footer?: React.ReactNode;
  /** Jumps the editor to a pending edit. Absent in the detached window,
   *  which can't scroll another window's document. */
  onRevealPending?: () => void;
  /** The chat has a fixed height to fill, so the message list renders even
   *  while empty, keeping the composer at the bottom. */
  fillHeight?: boolean;
  /** "quick" (the in-document Quick Ask bar) renders no conversation: a
   *  one-line reply summary, the pending bar and the composer. */
  variant?: "quick" | "full";
  /** Detached window only: fetches the editor's document and selection just
   *  before a send, since the user may have moved on since the last push.
   *  Resolves null if the editor doesn't answer; the last push is used. */
  refreshContext?: () => Promise<{
    document: DocumentSnapshot;
    selectionMarkdown: string | null;
    /** Text around the caret when nothing is selected. */
    cursor?: { before: string; after: string } | null;
    /** Heading of the section being worked in. */
    focusHeading?: string | null;
  } | null>;
  /** Quick variant only: the "review one at a time" nav bar's state and
   *  actions. Without it the quick variant renders no pending bar at all. */
  quickReview?: QuickReview;
  /** Quick variant docked on a phone: the panel's own controls, shown in
   *  the composer's top row. */
  dockActions?: React.ReactNode;
  selectionChip?: SelectionChipHandlers;
}

/** The Quick Ask nav bar's whole contract. */
export interface QuickReview {
  /** 0-based position of the currently focused edit, or -1 if none. */
  focusIndex: number;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  onAcceptFocused: () => void;
  onRejectFocused: () => void;
}

/** The propose_edit tool calls in `turns`, parsed for `onProposals`. Shared
 *  by the settled and the streamed path so the two can't drift. */
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
 * Whether the quick panel shows a finished exchange in full: a reply that
 * only answers does; one that proposed edits stays compact.
 */
export function quickReplyExpands(history: AgentTurn[]): boolean {
  const { turns } = lastExchange(history);
  const answered = turns.some(
    (turn) => turn.kind === "Assistant" && turn.text.trim().length > 0,
  );
  return answered && proposalsFromTurns(turns).length === 0;
}
