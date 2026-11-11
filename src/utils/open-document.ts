/**
 * Opening a file the window shows, from anywhere: a followed link, a card's
 * file, a project's document, the detached chat. One entry, registered by
 * whoever opens files in this window (the editor's window, or the detached
 * chat that hands them to it).
 */

export interface OpenRequest {
  /** A link's `#heading`, scrolled to once the tab shows. */
  anchor?: string;
  /** A link to a file of any type: one Textus can't show is offered to the
   *  system's app for it instead, after asking. */
  linked?: boolean;
  /** Reopening it: at its last caret. */
  restoreCaret?: boolean;
}

type Opener = (path: string, request: OpenRequest) => void;

let opener: Opener | null = null;
const opened = new Set<(path: string) => void>();

/** Who opens files here; returns the take-back. */
export function setDocumentOpener(open: Opener): () => void {
  opener = open;
  return () => {
    if (opener === open) opener = null;
  };
}

/** Opens `path` in a tab of its own, never in place of the one in use. */
export function openDocument(path: string, request: OpenRequest = {}): void {
  if (!path) return;
  opener?.(path, request);
  for (const tell of opened) tell(path);
}

/** Calls `told` with each file asked to open; returns the stop. */
export function onDocumentOpened(told: (path: string) => void): () => void {
  opened.add(told);
  return () => opened.delete(told);
}

// The dev server's tests open files as a click on a link would.
if (import.meta.env.DEV && typeof window !== "undefined")
  (
    window as unknown as { __devOpenDocument: typeof openDocument }
  ).__devOpenDocument = openDocument;
