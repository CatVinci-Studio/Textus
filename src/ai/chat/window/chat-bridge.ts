import type { DocumentSnapshot } from "../../doc-markdown";
import { emitTo } from "@tauri-apps/api/event";
import { listenToThisWindow } from "../../../utils/tauri-events";
import type { AgentTurn, EditProposal } from "../../types";
import type { PendingStatus } from "../../revision/usePendingEdits";
import type { SelectionChip } from "../ChatComposer";

/**
 * The protocol between an editor window and its detached chat window.
 *
 * The split is deliberate and one-directional in authority: the EDITOR
 * remains the sole owner of the document and of pending edits. A detached
 * chat window renders a conversation and asks for things; it never writes to
 * a document, never resolves an anchor, and holds no preview state of its
 * own. That keeps the "one place edits are applied" property the embedded
 * panel already has (see usePendingEdits) instead of growing a second
 * implementation that could drift.
 *
 * The chat window is also the CROSS-FILE surface (the in-document Quick Ask
 * bar is the per-file one), so which editor it is talking to is not fixed
 * for its lifetime. It re-addresses itself on every context push: whichever
 * editor last sent one is the editor its proposals and accept/reject calls
 * go back to. That is why `ChatContext` carries `editorLabel` - one
 * mechanism keeps "which document is on screen" and "where do replies go" in
 * lockstep, rather than two that can disagree.
 *
 * Transport is Tauri's window-targeted events (`emitTo`), so no Rust relay is
 * involved - the backend only creates the window, decides how many may exist
 * (commands/chat_window.rs), and hands over the initial state.
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
  /** Chat needs the document as it reads right now, before sending. The
   *  editor answers with a fresh `context`. Pull rather than push, because
   *  re-serializing the whole document on every keystroke to keep a pushed
   *  copy fresh would be pure waste - a send is the only moment it has to
   *  be exact. */
  requestContext: "chat:request-context",
  /** The composer's selection chip showed, went or was pointed at: the
   *  editor keeps the passage highlighted while it shows. */
  selectionChip: "chat:selection-chip",
  /** The selection chip was clicked: scroll the passage into view. */
  revealSelection: "chat:reveal-selection",
  /** A conversation picked from the window's history list belongs to this
   *  document: open it in a tab, so the context that follows names it and
   *  the window can restore the conversation (reopen-conversation.ts). */
  openDocument: "chat:open-document",
} as const;

/** Rust -> every editor window: the set of open chat windows changed (one
 *  opened, one closed, an editor window holding one was destroyed). Only the
 *  backend knows - a chat closed from ANOTHER editor window is invisible
 *  here, and pushing context at a destroyed label fails silently. Mirrors
 *  CHAT_WINDOWS_CHANGED in src-tauri/src/commands/chat_window.rs. */
export const CHAT_WINDOWS_CHANGED = "chat:windows-changed";

/** Rust -> one chat window: another handoff is parked under your label, claim
 *  it (`takeChatHandoff`) and adopt what it carries. Sent when detaching
 *  reveals a window that is already open rather than building a new one -
 *  that window mounted long ago, so nothing else would ever make it re-read
 *  the pending state. Mirrors CHAT_ADOPT_HANDOFF in
 *  src-tauri/src/commands/chat_window.rs. */
export const CHAT_ADOPT_HANDOFF = "chat:adopt-handoff";

/** Editor -> chat. */
export const EDITOR_TO_CHAT = {
  context: "chat:context",
  statuses: "chat:statuses",
} as const;

/** The editor's current document state, pushed to the chat window. */
export interface ChatContext {
  /** Document as markdown source - see doc-markdown.ts. */
  document: DocumentSnapshot;
  /** Selection as plain text, for the composer's chip. */
  selectedText: string | null;
  /** Selection as markdown - what actually rides with the request. */
  selectionMarkdown: string | null;
  docPath: string | null;
  /** The tab's display name (doc-tabs' `tabTitle`), for the window title.
   *  On the wire rather than derived from `docPath` on the receiving side:
   *  a Help doc has no path, so `basename` would call it "Untitled". */
  docTitle: string;
  /** Window label of the editor that sent this. The chat replies here - see
   *  the file comment on why the address travels with the context. */
  editorLabel: string;
}

/** Everything a detaching panel hands to its new window. */
export interface ChatHandoffState {
  context: ChatContext;
  /** Carried across so the conversation keeps ONE id through detach and
   *  re-embed - minting a new one each hop scatters a single exchange over
   *  several history entries. */
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

/** Every chat -> editor message naming a document carries the path it was
 *  meant for. With one chat window serving several files, the editor window
 *  that receives it may have moved on to a different tab, and applying an
 *  edit to the wrong document is silent and destructive. */
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

/** Accept-all / reject-all carry no call id, but they are just as
 *  doc-affecting as the rest - applying them to the wrong tab is silent. */
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

/** Typed `emitTo` - keeps event name and payload shape together. */
export function sendToWindow<T>(
  label: string,
  event: string,
  payload?: T,
): void {
  void emitTo(label, event, payload);
}

/** Typed listen, returning the same unlisten-promise shape callers already
 *  clean up elsewhere in this codebase. Scoped to the receiving window (see
 *  listenToThisWindow): with a second editor window open, a catch-all
 *  listener would pick up the other pair's chat traffic as its own. */
export function onWindowEvent<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  return listenToThisWindow<T>(event, (e) => handler(e.payload));
}
