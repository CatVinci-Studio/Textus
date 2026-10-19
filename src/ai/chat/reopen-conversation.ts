import {
  deleteConversation,
  loadConversationTurns,
  type ChatSummary,
} from "./chat-history";
import { requestChatRestore, type ChatRestore } from "./chat-restore";
import { fs } from "../../platform/ipc";
import { showConfirm } from "../../ui/app-dialog";
import { OPEN_FILE_IN_TAB_EVENT } from "../../utils/events";
import { basename } from "../../utils/path";
import type { Strings } from "../../i18n/strings";

/** Where a reopened conversation lands: the surface that takes it, and how
 *  that surface brings its document up. */
export interface ReopenTarget {
  restore: (restore: ChatRestore) => void;
  openDocument: (path: string) => void;
}

/** The docked panel's: the editor of the conversation's document claims it
 *  (chat-restore.ts), in a tab of this window. */
export const PANEL_REOPEN: ReopenTarget = {
  restore: requestChatRestore,
  openDocument: (path) =>
    window.dispatchEvent(
      new CustomEvent(OPEN_FILE_IN_TAB_EVENT, { detail: path }),
    ),
};

/**
 * A click on a past conversation in the history list (ChatHistoryMenu): it
 * reopens with its own document - that document's tab, opened if need be -
 * never in whichever document happens to be on screen, where its next save
 * would file it under the wrong document. A document that's gone is asked
 * about first: the conversation continues in the current one only if the
 * user says so (and is filed under it from then on). A conversation of a
 * document never saved has no other home and continues in the current one.
 */
export async function reopenConversation(
  entry: ChatSummary,
  t: Strings,
  target: ReopenTarget = PANEL_REOPEN,
) {
  let turns;
  try {
    turns = await loadConversationTurns(entry.id);
  } catch {
    return;
  }
  // Listed, but its file is gone (deleted by hand): the line points nowhere.
  if (!turns) return deleteConversation(entry.id);
  const { id, docPath } = entry;
  if (!docPath) return target.restore({ id, turns, docPath: null });
  if (await documentExists(docPath)) {
    target.restore({ id, turns, docPath });
    target.openDocument(docPath);
    return;
  }
  const continueHere = await showConfirm(
    t.chatHistoryMissingText.replace("{name}", basename(docPath)),
    {
      title: t.chatHistoryMissingTitle,
      okLabel: t.chatHistoryContinueHere,
      cancelLabel: t.cancel,
    },
  );
  if (continueHere) target.restore({ id, turns, docPath: null });
}

// Read rather than stat'ed: a document picked in the iOS Files app has no
// mtime to ask for, only text.
function documentExists(path: string): Promise<boolean> {
  return fs.readTextFile(path).then(
    () => true,
    () => false,
  );
}
