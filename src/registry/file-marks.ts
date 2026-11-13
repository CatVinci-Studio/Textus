import { useSyncExternalStore } from "react";

/** What a file's row says something left in it: changed, and how much
 *  waits for the writer. */
export interface FileMark {
  changed: boolean;
  /** Revisions waiting, if any. */
  pending?: number;
  /** Made, waiting to be kept. */
  created?: boolean;
}

/** Where the marks come from: a feature that changes files (Textus AI)
 *  provides them; with none, no row is marked. */
interface FileMarks {
  subscribe: (listener: () => void) => () => void;
  markOf: (path: string) => FileMark | null;
}

let source: FileMarks | null = null;
const none = () => () => {};

export function provideFileMarks(next: FileMarks): void {
  source = next;
}

/** A mark as one string, so a row compares its own and draws again only
 *  when that one changed. */
const keyOf = (mark: FileMark | null) =>
  mark ? `${+mark.changed}|${mark.pending ?? ""}|${+!!mark.created}` : "";

/** File `path`'s mark, following it as it changes. */
export function useFileMark(path: string): FileMark | null {
  useSyncExternalStore(source?.subscribe ?? none, () =>
    keyOf(source?.markOf(path) ?? null),
  );
  return source?.markOf(path) ?? null;
}
