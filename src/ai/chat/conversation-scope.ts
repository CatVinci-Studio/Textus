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
  noteOpen(scope, id);
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

/** The scope a conversation belongs to: the folder (the chosen one, else
 *  the document's own), or a file opened on its own; null for a draft never
 *  saved, which keeps its own. */
export function conversationScope(
  docPath: string | null,
  workspaceRoot: string | null,
): string | null {
  return docPath ? (workspaceRoot ?? docPath) : null;
}

/**
 * The conversations open in a scope's AI island, as its tabs, in order:
 * every one made live joins them; closing one takes it out (it stays in the
 * history). Kept beside the live one, in every window.
 */
const OPEN = "textus-ai-open:";
const openListeners = new Set<() => void>();
const openCache = new Map<string, string[]>();

export function openConversations(scope: string): string[] {
  const cached = openCache.get(scope);
  if (cached) return cached;
  let ids: string[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN + scope) ?? "[]");
    if (Array.isArray(raw)) ids = raw.filter((x) => typeof x === "string");
  } catch {
    // None kept, or unreadable: none open.
  }
  openCache.set(scope, ids);
  return ids;
}

function setOpen(scope: string, ids: string[]) {
  openCache.set(scope, ids);
  try {
    localStorage.setItem(OPEN + scope, JSON.stringify(ids));
  } catch {
    // Storage full or off: kept for this window.
  }
  for (const listener of openListeners) listener();
}

function noteOpen(scope: string, id: string) {
  const ids = openConversations(scope);
  if (!ids.includes(id)) setOpen(scope, [...ids, id]);
}

/** Takes `id` out of the scope's tabs; the one beside it, if any, is what
 *  should be live next when `id` was. */
export function closeConversation(scope: string, id: string): string | null {
  const ids = openConversations(scope);
  const at = ids.indexOf(id);
  if (at < 0) return null;
  const rest = ids.filter((x) => x !== id);
  setOpen(scope, rest);
  return rest[Math.min(at, rest.length - 1)] ?? null;
}

/** Moves `id` to `index` among the scope's other tabs. */
export function reorderConversation(scope: string, id: string, index: number) {
  const rest = openConversations(scope).filter((x) => x !== id);
  rest.splice(index, 0, id);
  setOpen(scope, rest);
}

/** Calls `listener` when any scope's open conversations change, here or
 *  in another window. */
export function onOpenConversations(listener: () => void): () => void {
  openListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (!e.key?.startsWith(OPEN)) return;
    openCache.delete(e.key.slice(OPEN.length));
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    openListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
