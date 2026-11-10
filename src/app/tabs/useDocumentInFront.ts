import { useRef } from "react";
import type { DocTab } from "../../document/doc-tabs";

/**
 * The window's document in front: the active tab when it is a document,
 * else the document last in front - with an AI conversation, Settings or a
 * plugin's page in front, that document is still the one the AI reads and
 * writes.
 */
export function useDocumentInFront(
  tabs: readonly DocTab[],
  activeTabId: string,
): string {
  const last = useRef(activeTabId);
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (active && !active.view) last.current = activeTabId;
  if (tabs.some((tab) => tab.id === last.current && !tab.view))
    return last.current;
  return tabs.find((tab) => !tab.view)?.id ?? activeTabId;
}
