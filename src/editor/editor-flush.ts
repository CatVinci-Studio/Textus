// Milkdown's listener reports markdown on a 200ms debounce with no maxWait,
// so a typing burst can leave the tab's `content` behind. Anything acting on
// `content` must first pull the live document through here.

type Flusher = () => string | null;

const flushers = new Map<string, Flusher>();

/** Registers the mounted editor of `tabId`; returns the unregister call. */
export function registerEditorFlush(tabId: string, flush: Flusher) {
  flushers.set(tabId, flush);
  return () => {
    if (flushers.get(tabId) === flush) flushers.delete(tabId);
  };
}

/**
 * Pushes any unreported edit of `tabId`'s editor through synchronously and
 * returns the live markdown, or null when the tab's `content` is current.
 */
export function flushEditor(tabId: string): string | null {
  return flushers.get(tabId)?.() ?? null;
}
