import { conversationScope } from "../../ai/chat/conversation-scope";
import { isIOSApp } from "../../platform/capabilities";
import type { TabState } from "../tabs/useTabState";
import { useDocumentInFront } from "../tabs/useDocumentInFront";
import { useAiTabs } from "./useAiTabs";

/**
 * The window's AI: the conversations of the document in front's folder -
 * with an AI tab or a page in front, still that document's - as tabs on
 * the desktop (useAiTabs); the iPhone and iPad draw the live one in
 * their panel.
 */
export function useWindowAi({
  tabs,
  workspaceRoot,
  shown,
  setShown,
}: {
  tabs: TabState;
  /** Settings' folder for conversations, if one is chosen. */
  workspaceRoot: string | null;
  shown: boolean;
  setShown: (shown: boolean) => void;
}): void {
  const { tabs: list, activeTabId } = tabs;
  const docInFront = useDocumentInFront();
  const inFront =
    list.find((tab) => tab.id === docInFront) ??
    list.find((tab) => tab.id === activeTabId);
  useAiTabs({
    tabs,
    scope: conversationScope(inFront?.path ?? null, workspaceRoot),
    shown: !isIOSApp && shown,
    setShown,
  });
}
