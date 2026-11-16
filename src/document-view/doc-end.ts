import { useCallback, useSyncExternalStore } from "react";

/** Each document's end: the place under its last block, where a touch
 *  screen shows its word count (DocumentCorner), in the text's flow. */
const ends = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

/** The ref for a document's end element (EditorPane). */
export function useDocEndRef(tabId: string) {
  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      ends.set(tabId, el);
      tell();
      return () => {
        if (ends.get(tabId) === el) ends.delete(tabId);
        tell();
      };
    },
    [tabId],
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A document's end element, once drawn. */
export function useDocEnd(tabId: string): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => ends.get(tabId) ?? null);
}
