// The documents open in this window's tabs, by path: each editor sets its
// own, and what reads a file (a rename's link update, a plugin) reads the
// open text over the saved one.

/** A document open in a tab, in front or not. */
export interface OpenDocumentAccess {
  text(): string;
  /** Names its version: changes whenever its text does. */
  revision(): string;
  /** Replaces its text, as one undo step, if it is still at `revision`;
   *  false otherwise. */
  replaceText(text: string, revision: string): boolean;
}

/** Every document open in a tab, by its path (an editor sets its own). */
const openDocuments = new Map<string, OpenDocumentAccess>();

export function setOpenDocument(
  path: string,
  access: OpenDocumentAccess | null,
  owner?: OpenDocumentAccess,
): void {
  if (access) openDocuments.set(path, access);
  else if (!owner || openDocuments.get(path) === owner)
    openDocuments.delete(path);
}

export function openDocumentAt(path: string): OpenDocumentAccess | null {
  return openDocuments.get(path) ?? null;
}

/** Whether the document at a path has unsaved changes: the window says. */
let unsaved: (path: string) => boolean = () => false;

export function setUnsavedCheck(check: ((path: string) => boolean) | null) {
  unsaved = check ?? (() => false);
}

/** The document at `path` while it has unsaved changes: what a change to
 *  the file makes in its editor, so nothing typed is lost. A saved one is
 *  changed on disk, and its tab takes the new text. */
export function unsavedDocumentAt(path: string): OpenDocumentAccess | null {
  return unsaved(path) ? openDocumentAt(path) : null;
}
