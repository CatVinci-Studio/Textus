import type { DocumentSnapshot } from "../../doc-markdown";
import { emitToWindow } from "../../../platform/events";
import { listenToThisWindow } from "../../../platform/events";
import type { AgentTurn, EditProposal } from "../../types";
import type { PendingStatus } from "../../revision/usePendingEdits";
import type { SelectionChip } from "../ChatComposer";

/**
 * The protocol between an editor window and its detached chat window. The
 * editor alone owns the document and pending edits; the chat only asks, and
 * replies to whichever editor last pushed context.
 */

/** Chat -> editor. */
export const CHAT_TO_EDITOR = {
  proposals: "chat:proposals",
  accept: "chat:accept",
  reject: "chat:reject",
  acceptAll: "chat:accept-all",
  rejectAll: "chat:reject-all",
  /** The chat window is going away; the editor re-embeds the panel. */
  reembed: "chat:reembed",
  /** Ask for a fresh `context` before sending. Pulled, not pushed, so the
   *  document isn't re-serialized on every keystroke. */
  requestContext: "chat:request-context",
  /** The composer's selection chip showed, went or was pointed at: the
   *  editor keeps the passage highlighted while it shows. */
  selectionChip: "chat:selection-chip",
  /** The selection chip was clicked: scroll the passage into view. */
  revealSelection: "chat:reveal-selection",
  /** Open a history conversation's document in a tab, so the window can
   *  restore that conversation. */
  openDocument: "chat:open-document",
} as const;

/** Rust -> every editor window: the set of open chat windows changed. Only the
 *  backend sees chats closed from another editor window. Keep in step with Rust. */
export const CHAT_WINDOWS_CHANGED = "chat:windows-changed";

/** Rust -> one chat window: claim the handoff parked under your label. Sent
 *  when detaching reveals an already-open window, which won't re-read it alone. */
export const CHAT_ADOPT_HANDOFF = "chat:adopt-handoff";

/** Editor -> chat. */
export const EDITOR_TO_CHAT = {
  context: "chat:context",
  statuses: "chat:statuses",
} as const;

/** The editor's current document state, pushed to the chat window. */
export interface ChatContext {
  document: DocumentSnapshot;
  /** Selection as plain text, for the composer's chip. */
  selectedText: string | null;
  /** Selection as markdown - what actually rides with the request. */
  selectionMarkdown: string | null;
  docPath: string | null;
  /** The tab's display name, for the window title. Sent, not derived from
   *  `docPath`: a Help doc has no path. */
  docTitle: string;
  /** Window label of the editor that sent this; the chat replies here. */
  editorLabel: string;
}

/** Everything a detaching panel hands to its new window. */
export interface ChatHandoffState {
  context: ChatContext;
  /** Kept through detach and re-embed so one exchange stays one history entry. */
  conversationId: string;
  turns: AgentTurn[];
  /** Statuses of proposals already on screen, so a detached window doesn't
   *  show every past card as freshly pending. */
  statuses: Record<string, PendingStatus>;
}

export interface ChatHandoff {
  editorLabel: string;
  state: ChatHandoffState;
}

/** The document a chat -> editor message was meant for: the editor may have
 *  switched tabs, and an edit applied to the wrong document is silent. */
export interface DocScopedMessage {
  docPath: string | null;
}

export interface ProposalsMessage extends DocScopedMessage {
  proposals: { callId: string; proposal: EditProposal }[];
}

export interface CallIdMessage extends DocScopedMessage {
  callId: string;
}

export interface SelectionChipMessage extends DocScopedMessage {
  chip: SelectionChip;
}

export type BulkDecisionMessage = DocScopedMessage;

/** Sent back when the detached window closes, so the editor can resume the
 *  same conversation in the embedded panel. */
export interface ReembedMessage {
  conversationId: string;
  turns: AgentTurn[];
  /** The document the conversation was last about - only that tab takes it
   *  back (null: an unsaved draft, matched as the active tab). */
  docPath: string | null;
}

export interface OpenDocumentMessage {
  path: string;
}

export function sendToWindow<T>(
  label: string,
  event: string,
  payload?: T,
): void {
  void emitToWindow(label, event, payload);
}

/** Typed listen scoped to this window, so another editor pair's chat traffic
 *  isn't picked up. */
export function onWindowEvent<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  return listenToThisWindow<T>(event, (e) => handler(e.payload));
}
