import { DRAFT } from "../../ai/chat/conversation-scope";

/** The AI button pressed while the AI is shown: the window decides what
 *  that does with its AI tabs (useAiTabs). */
export const AI_PRESS_EVENT = "textus:ai-press";

/** The conversation an AI tab shows, from its tab's state. */
export function conversationIn(state: unknown): string {
  return (state as { conversation?: string } | null)?.conversation ?? DRAFT;
}

// The tabs' opener lives with the conversations, which History reaches.
// eslint-disable-next-line no-restricted-syntax -- re-exported for the window's hooks
export {
  newConversation,
  openConversationTab,
  setConversationOpener,
} from "../../ai/chat/conversation-tabs";
