import { conversationFor } from "./conversation/conversation-registry";
import type { AgentTurn } from "../types";

/** Opens conversation `id` (a new one by default) in a tab beside
 *  `from`'s, or the live one's (useAiTabs); false where conversations have
 *  no place to be kept (no folder, no file) or no tabs (iPhone, iPad). */
let opener:
  | ((from: string | null, id?: string, docPath?: string | null) => boolean)
  | null = null;

export function setConversationOpener(open: typeof opener): void {
  opener = open;
}

/** An AI tab's +: a new conversation in a tab of its own beside it, or,
 *  with nowhere to keep more than one, `startOver` in its own. */
export function newConversation(from: string, startOver: () => void): void {
  if (!opener?.(from)) startOver();
}

/** A conversation reopened from History, or carried on from Quick Ask
 *  (`turns`), in a tab of its own rather than over the one in front; false
 *  where there are no AI tabs. `docPath`: the document it belongs to, whose
 *  conversations it joins where they are kept per document (no folder). */
export function openConversationTab(
  id: string,
  turns?: AgentTurn[],
  docPath?: string | null,
): boolean {
  if (!opener) return false;
  if (turns) conversationFor(id, null).restore(id, turns);
  return opener(null, id, docPath);
}
