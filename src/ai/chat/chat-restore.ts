import type { AgentTurn } from "../types";
import { RESTORE_CHAT_EVENT } from "../../utils/events";

/** A saved conversation on its way from the history list to an editor. */
export interface ChatRestore {
  id: string;
  turns: AgentTurn[];
  /** The document whose editor takes it, or null for the one on screen
   *  (a conversation of a document never saved, or one continued here). */
  docPath: string | null;
}

let pending: ChatRestore | null = null;

/**
 * Hands `restore` to the editor it is for. Kept until that editor claims it,
 * since the document may only now be opening.
 */
export function requestChatRestore(restore: ChatRestore) {
  pending = restore;
  window.dispatchEvent(new Event(RESTORE_CHAT_EVENT));
}

/** The pending restore, taken, if it is for the editor of `docPath`. */
export function claimChatRestore(
  docPath: string | null,
  isOnScreen: () => boolean,
): ChatRestore | null {
  if (!pending) return null;
  const mine =
    pending.docPath === null ? isOnScreen() : pending.docPath === docPath;
  if (!mine) return null;
  const restore = pending;
  pending = null;
  return restore;
}
