import type { BlockNames } from "../revision/markdown-forms";
import { type AgentTurnLabels } from "./AgentTurnView";
import type { AgentTurn, EditAction, EditProposal } from "../types";
import type { PendingStatus } from "../revision/usePendingEdits";
import type { StreamingState } from "./stream-step";
import type { Thought } from "./thought";
import { type ThoughtRowLabels } from "./ThoughtRow";
import type { AiErrorKind } from "../error-messages";
import type { PendingSentence } from "../revision/pending-edit-plugin";
import { type MemoryChipLabels } from "./MemoryChip";

/** What ChatMessages is given: its words and its props. */

export interface ChatMessagesLabels
  extends AgentTurnLabels, MemoryChipLabels, ThoughtRowLabels {
  thinking: string;
  /** "{n} seconds", after the indicator's label once nothing has moved
   *  for a while. */
  waitedFor: (seconds: number) => string;
  proposalTitle: string;
  proposalStatus: Record<Exclude<PendingStatus, "pending">, string>;
  proposalAccept: string;
  proposalPicturePainting: string;
  proposalReject: string;
  proposalAcceptAll: string;
  proposalRejectAll: string;
  /** "Show {n} more" and back, under a group's first rows. */
  proposalGroupMore: string;
  proposalGroupLess: string;
  /** Offered when an anchor no longer resolves - asks the model to re-issue
   *  the proposal against the document as it now reads. */
  proposalRelocate: string;
  /** Tooltips of the "+X −Y" chips that open and close the full diff. */
  diffCollapse: string;
  diffShow: string;
  actionNames: Record<EditAction, string>;
  retry: string;
  /** The Accept button while some sentences are kept as written: "{k}" of
   *  "{n}". */
  proposalAcceptSome: string;
  /** How many sentences a rewrite changes: "{n} changes". */
  proposalChangeCount: string;
  /** The ✓ / ✕ on a sentence (the card's and the text's). */
  proposalTakeSentence: string;
  proposalKeepSentence: string;
  /** What a change of a whole block is called on its card, by its kind. */
  proposalBlocks: BlockNames;
  /** Scrolls the document to the proposal. */
  proposalShowInText: string;
  /** The checkbox on a proposal that cites the web. */
  proposalSourcesAsFootnotes: string;
  /** An add_comment card's title and jump-to-passage link. */
  commentTitle: string;
  commentLocate: string;
  /** "{n} notes", heading a reply's notes shown as one card. */
  commentCount: string;
  commentGroupMore: string;
  /** Plain-language help per kind of provider failure. */
  aiErrors: Record<AiErrorKind, string>;
  /** A generate_image card's kind, and the line for a picture that wasn't
   *  made ("{reason}": the service's words). */
  proposalImage: string;
  imageLimitReached: string;
  imageNoModel: string;
  /** In place of "Thinking…" while a picture is being made. */
  generatingImage: string;
  /** In place of "Thinking…" while an edit's call streams in. */
  writingEdit: string;
  /** In place of "Thinking…" while a review note's call streams in. */
  writingNotes: string;
  /** The reply of an exchange that ran out of steps, and the button that
   *  asks it to go on. */
  stoppedAtLimit: string;
  continueAfterLimit: string;
}

export interface ChatMessagesProps {
  history: AgentTurn[];
  /** Live view of the in-flight exchange (turns landed so far + assistant
   *  prose being generated). Null when idle - and on providers without
   *  streaming, where the reply still arrives all at once via `history`. */
  streaming: StreamingState | null;
  /** Finished exchanges' thinking, by their user turn's index in
   *  `history`. */
  thoughts?: Record<number, Thought>;
  busy: boolean;
  error: string | null;
  selectedText: string | null;
  labels: ChatMessagesLabels;
  proposalStatus: (callId: string) => PendingStatus;
  /** `text`: a partial acceptance. */
  onAcceptProposal: (callId: string, text?: string) => void;
  /** A pending rewrite's sentences and the writer's call on each; absent
   *  where the document isn't reachable (the detached window). */
  proposalSentences?: (callId: string) => PendingSentence[] | null;
  /** A ✓ / ✕ on a card's sentence - the same decision as in the text. */
  onDecideSentence?: (
    callId: string,
    index: number,
    take: boolean | null,
  ) => void;
  /** Scrolls the document to a proposal's sentence (index -1: the whole
   *  proposal). */
  onRevealProposal?: (callId: string, index: number) => void;
  /** Jumps to an add_comment card's passage in the document; absent where
   *  the document isn't reachable (the detached window). */
  onLocateText?: (anchor: string, block?: string) => void;
  /** The number on an add_comment note's badge in the text, for its card
   *  to show the same; null while the note has none (a margin has room
   *  for it, or it was never placed). */
  noteNumber?: (callId: string) => number | null;
  onRejectProposal: (callId: string) => void;
  /** Asks the model to re-propose an edit whose anchor went stale. */
  onRelocateProposal: (proposal: EditProposal) => void;
  /** False where another control decides pending edits (Quick Ask's
   *  review bar) - the cards then show what each edit is, without a second
   *  set of Accept/Reject buttons. */
  proposalActions?: boolean;
  /** Set only when `error` came from a failed send whose (document, message)
   *  is still available to resend - not every error is retryable this way. */
  canRetry: boolean;
  onRetry: () => void;
  /** Asks the model to go on after an exchange ran out of steps; absent
   *  where nothing can be sent from here. */
  onContinue?: () => void;
  /** The conversation's document, whose project a remembered project
   *  memory belongs to. */
  docPath?: string | null;
}
