import { useSyncExternalStore } from "react";
import { documentInFront, subscribeSplit } from "../../engine/layout/store";

/**
 * The window's document in front, as its model keeps it: the active tab
 * when it is a document, else the document last in front - with an AI
 * conversation, Settings or a plugin's page in front, that document is
 * still the one the AI reads and writes.
 */
export function useDocumentInFront(): string {
  return useSyncExternalStore(subscribeSplit, documentInFront);
}
