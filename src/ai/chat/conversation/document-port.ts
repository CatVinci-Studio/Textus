import type { StreamEvent } from "../../../platform/ipc";
import type { Genre } from "../../../platform/bindings/ai-paper";
import type { PendingStatus } from "../../revision/usePendingEdits";
import type { ChatBodyProps } from "../chat-body-types";

/**
 * The document in front, as the window's conversations reach it: one at a
 * time, attached by its editor. A request is sent about it and its
 * proposals stream into it; with none attached a conversation works on the
 * folder alone.
 */
export interface DocumentPort {
  docPath: string | null;
  /** Raw stream events beyond the reply, e.g. propose_edit fragments that
   *  grow the in-document preview. */
  onStreamEvent: (event: StreamEvent) => void;
  /** A reply sent about this document ended, whatever is on screen now:
   *  its edits still being written are finished or, on failure, dropped. */
  onReplyEnd?: (failed: boolean) => void;
  /** Per-callId status of every proposal so far, annotated onto the history
   *  at send so the model doesn't assume an undecided proposal was applied. */
  proposalStatuses: () => Record<string, PendingStatus>;
}

/** What the AI's panel shows of the document in front and does in it,
 *  as it reads on the editor's last render. */
export interface DocumentPanel {
  /** The document, selection and proposals as the chat body takes them. */
  chat: Pick<
    ChatBodyProps,
    | "selectedText"
    | "selectionIsPicture"
    | "selectionChip"
    | "tourMode"
    | "refreshContext"
    | "proposalStatus"
    | "pendingCount"
    | "onProposals"
    | "onAcceptProposal"
    | "proposalSentences"
    | "onDecideSentence"
    | "onRevealProposal"
    | "onLocateText"
    | "noteNumber"
    | "onRejectProposal"
    | "onAcceptAll"
    | "onRejectAll"
    | "onRevealPending"
  >;
  /** The document's text, for what the folder's memory says of it. */
  documentText: () => string;
  /** A new conversation, asked of the document: undecided edits first. */
  onNewConversation: () => void;
  onPopOut: () => void;
  /** Replacing the conversation asked first (edits still undecided):
   *  whether it is asking, and going on or not. */
  guard: boolean;
  proceed: () => void;
  cancelGuard: () => void;
  /** Starts a paper on a topic. */
  writePaper: (
    topic: string,
    genre: Genre | null,
    conversation: string,
  ) => void;
}

/** The document in front: its port, the same object while it stays, and
 *  its panel's part (none where another window draws the chat). */
export interface AttachedDocument {
  port: DocumentPort;
  panel?: DocumentPanel;
}

let attached: AttachedDocument | null = null;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/** `port`'s document is the one in front, its panel as `panel` reads now. */
export function attachDocument(port: DocumentPort, panel?: DocumentPanel) {
  attached = { port, panel };
  changed();
}

/** `port`'s document left the front; a later one's stays. */
export function detachDocument(port: DocumentPort): void {
  if (attached?.port !== port) return;
  attached = null;
  changed();
}

export function attachedDocument(): AttachedDocument | null {
  return attached;
}

export function onAttachedDocument(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
