import { createSubscribers } from "../../utils/store";
import type { StoredOwnNote } from "./own-notes";

/**
 * The notes of each document open in an editor, reached by its path: while
 * one is open its editor owns them, and plugins' comments go through it so
 * neither overwrites the other's.
 */
interface OpenNotes {
  /** Whether its notes are read yet; until then the file is theirs. */
  ready(): boolean;
  list(): StoredOwnNote[];
  /** A note on the first place `anchor` is; its id, or null when the
   *  words aren't in the document. */
  add(note: { anchor: string; comment: string; author: string }): string | null;
  remove(id: string): boolean;
}

const open = new Map<string, OpenNotes>();
const changes = createSubscribers<[path: string]>();

/** The editor of `path` holds its notes, until the returned call. */
export function holdNotes(path: string, notes: OpenNotes): () => void {
  open.set(path, notes);
  return () => {
    if (open.get(path) === notes) open.delete(path);
  };
}

export const openNotes = (path: string): OpenNotes | null =>
  open.get(path) ?? null;

/** The notes of `path` were written. */
export const notesChanged = (path: string): void => changes.publish(path);

export const onNotesChanged = changes.subscribe;

export const newNoteId = (who: string) =>
  `${who}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
