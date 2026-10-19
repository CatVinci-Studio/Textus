/**
 * Each tab's caret as it leaves the screen, for reopening a document where
 * it was left (document/last-carets.ts): the editor reports it when its tab
 * is switched away from or closed, or the window loses focus
 * (useTabCaret.ts), and can be asked for it while it is open - a closing
 * window has no other moment to tell.
 */

/**
 * Where a caret is: an offset into the document's markdown, or - in a
 * large document (editor/large-doc.ts), where the markdown before the
 * caret took the better part of a second to write out and read back - its
 * ProseMirror position. Either holds only for the file as it was: whoever
 * keeps one keeps the file's modified time with it.
 */
export type CaretPlace = { offset: number } | { pos: number };

type Reader = () => CaretPlace | null;

const readers = new Map<string, Reader>();
let sink: ((tabId: string, caret: CaretPlace) => void) | null = null;

/** Registers the mounted editor of `tabId`; returns the unregister call. */
export function registerTabCaret(tabId: string, read: Reader): () => void {
  readers.set(tabId, read);
  return () => {
    if (readers.get(tabId) === read) readers.delete(tabId);
  };
}

/** The caret of `tabId`'s mounted editor, or null. */
export function readTabCaret(tabId: string): CaretPlace | null {
  return readers.get(tabId)?.() ?? null;
}

/** Where reported carets go; one per window. Returns the unregister. */
export function setTabCaretSink(
  receive: (tabId: string, caret: CaretPlace) => void,
): () => void {
  sink = receive;
  return () => {
    if (sink === receive) sink = null;
  };
}

/** An editor's caret as its tab leaves the screen. */
export function reportTabCaret(tabId: string, caret: CaretPlace | null): void {
  if (caret) sink?.(tabId, caret);
}
