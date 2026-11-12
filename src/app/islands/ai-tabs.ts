import { DRAFT } from "../../ai/chat/conversation-scope";

/** The AI button pressed while the AI is shown: the window decides what
 *  that does with its AI tabs (useAiTabs). */
export const AI_PRESS_EVENT = "textus:ai-press";

/** The conversation an AI tab shows, from its tab's state. */
export function conversationIn(state: unknown): string {
  return (state as { conversation?: string } | null)?.conversation ?? DRAFT;
}

/** Opens a new conversation in a tab beside `from`'s (useAiTabs); false
 *  where conversations have no place to be kept (no folder, no file). */
let opener: ((from: string) => boolean) | null = null;

export function setConversationOpener(open: typeof opener): void {
  opener = open;
}

/** An AI tab's +: a new conversation in a tab of its own beside it, or,
 *  with nowhere to keep more than one, `startOver` in its own. */
export function newConversation(from: string, startOver: () => void): void {
  if (!opener?.(from)) startOver();
}
