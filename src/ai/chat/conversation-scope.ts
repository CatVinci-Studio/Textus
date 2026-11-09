/**
 * Which conversation is the live one for a folder, or for a file opened on
 * its own: one per scope, shared by every tab and window there, so moving to
 * another page or window keeps the conversation. In localStorage, whose
 * storage event tells the other windows; an unsaved draft has no scope and
 * keeps its own.
 */
const PREFIX = "textus-ai-live:";

type Listener = (scope: string, id: string) => void;
const listeners = new Set<Listener>();

/** The scope's live conversation, if one was ever started there. */
export function liveConversation(scope: string): string | null {
  try {
    return localStorage.getItem(PREFIX + scope);
  } catch {
    return null;
  }
}

/** Makes `id` the scope's live conversation, in every window. */
export function setLiveConversation(scope: string, id: string) {
  try {
    if (localStorage.getItem(PREFIX + scope) === id) return;
    localStorage.setItem(PREFIX + scope, id);
  } catch {
    return;
  }
  for (const listener of listeners) listener(scope, id);
}

/** Calls `listener` when a scope's live conversation changes, here or in
 *  another window. */
export function onLiveConversation(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(PREFIX) && e.newValue)
      listener(e.key.slice(PREFIX.length), e.newValue);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
