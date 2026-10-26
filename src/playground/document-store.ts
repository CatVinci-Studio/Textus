/**
 * The playground's one document, kept in localStorage. A browser that refuses
 * storage still edits; the document just lasts as long as the page.
 */

export const DOCUMENT_KEY = "textus-playground:document";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The saved document, or null on a first visit. */
export function loadDocument(store = browserStore()): string | null {
  try {
    return store?.getItem(DOCUMENT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveDocument(markdown: string, store = browserStore()): void {
  try {
    store?.setItem(DOCUMENT_KEY, markdown);
  } catch {
    // No room or no storage: the page keeps the document for this visit.
  }
}
