import { LOCAL_KEYS, readLocal, writeLocal } from "../../../storage/local";

/**
 * Who answers in a conversation - an outside agent's key, "" for Textus
 * AI - kept by conversation in every window: each AI tab its own, the
 * setting only the one a new conversation starts with.
 */
export function storedAgent(id: string): string | null {
  return readLocal(LOCAL_KEYS.conversationAgent + id);
}

export function storeAgent(id: string, agent: string): void {
  writeLocal(LOCAL_KEYS.conversationAgent + id, agent);
}
