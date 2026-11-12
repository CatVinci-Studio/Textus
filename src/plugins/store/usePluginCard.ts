import { useSyncExternalStore } from "react";
import {
  catalogSnapshot,
  subscribeCatalog,
  type CatalogItem,
  catalogItem,
} from "./catalog";
import {
  answerPluginCard,
  currentPluginCard,
  mutedCardCount,
  restoreCards,
  subscribePluginCard,
  type CardChoice,
  type CardRequest,
} from "./plugin-card";

/** The suggestion card to draw: the request, the plugin's catalog entry
 *  (description, author, installs, permissions in its manifest) and the
 *  way to answer. Null while no card shows. */
export function usePluginCard(): {
  request: CardRequest;
  item: CatalogItem | null;
  answer: (choice: CardChoice) => void;
} | null {
  const request = useSyncExternalStore(subscribePluginCard, currentPluginCard);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  if (!request) return null;
  const item = catalogItem(request.plugin, catalog) ?? null;
  return { request, item, answer: answerPluginCard };
}

/** Settings › Extensions: how many situations' cards were put away, and
 *  the way to bring them all back. */
export function useMutedCards(): { count: number; restore: () => void } {
  const count = useSyncExternalStore(subscribePluginCard, mutedCardCount);
  return { count, restore: restoreCards };
}
