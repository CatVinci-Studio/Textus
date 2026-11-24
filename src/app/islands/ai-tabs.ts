import { DRAFT } from "../../ai/chat/conversation-scope";

/** The AI button pressed while the AI is shown: the window decides what
 *  that does with its AI tabs (useAiTabs). */
const presses = createSubscribers();
export const onAiPress = presses.subscribe;
export const pressAi = presses.publish;

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
import { createSubscribers } from "../../utils/store";

/** A tab row's +: over an AI tab, a new conversation beside it, as the
 *  AI's own + makes; else (or where no more conversations can be kept)
 *  `addDocument`. */
export function addFromTabRow(
  front:
    | { view?: { kind: string; view: string; state?: unknown } | null }
    | undefined,
  addDocument: () => void,
  newConversation: (from: string, fallback: () => void) => void,
): void {
  const view = front?.view;
  if (isConversationTab(front))
    newConversation(conversationIn(view?.state), addDocument);
  else addDocument();
}

/** Whether a tab is an AI conversation's: the tab row's + starts another. */
export function isConversationTab(
  tab: { view?: { kind: string; view: string } | null } | undefined,
): boolean {
  return tab?.view?.kind === "page" && tab.view.view === "ai";
}
