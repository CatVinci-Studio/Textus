import { useSyncExternalStore } from "react";
import { createSubscribers } from "../../utils/store";

/**
 * The plugins' slips each tab's editor shows, for its corner's count and
 * the list it opens. Only while there are some: no count, no list.
 */
interface Slip {
  /** Who found it. */
  label: string;
  message: string;
  /** Puts the caret in it, which opens its card. */
  go: () => void;
}

const NONE: readonly Slip[] = [];
const byTab = new Map<string, readonly Slip[]>();
const subscribers = createSubscribers();

export function publishSlips(tabId: string, slips: readonly Slip[]): void {
  const before = byTab.get(tabId) ?? NONE;
  if (before.length === 0 && slips.length === 0) return;
  if (slips.length) byTab.set(tabId, slips);
  else byTab.delete(tabId);
  subscribers.publish();
}

export function useSlips(tabId: string): readonly Slip[] {
  return useSyncExternalStore(
    subscribers.subscribe,
    () => byTab.get(tabId) ?? NONE,
  );
}
