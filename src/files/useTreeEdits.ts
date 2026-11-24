import type { RefObject } from "react";
import type { Strings } from "../i18n/strings";
import { useFileUndo } from "./useFileUndo";
import { useNewEntry } from "./useNewEntry";
import { useRename } from "./useRename";

/** The tree's own changes to its folder: entries named and renamed in
 *  place, and the undo stack every operation records in (its one owner). */
export function useTreeEdits(input: {
  treeRef: RefObject<HTMLDivElement | null>;
  /** The folder the tree shows. */
  folder: string;
  t: Strings;
  reload: (...dirs: string[]) => void;
  onFileSelect: (path: string) => void;
  onEntryMoved: (from: string, to: string) => void;
}) {
  const { treeRef, folder, t, reload } = input;
  const fileUndo = useFileUndo(treeRef, folder, reload, input.onEntryMoved);
  const naming = useNewEntry(t, reload, input.onFileSelect, fileUndo);
  const renaming = useRename({
    linkBase: folder,
    t,
    reload,
    onEntryMoved: input.onEntryMoved,
    fileUndo,
  });
  return { fileUndo, ...naming, ...renaming };
}
