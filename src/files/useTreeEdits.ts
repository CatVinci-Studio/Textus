import type { RefObject } from "react";
import type { Strings } from "../i18n/strings";
import { useFileUndo } from "./useFileUndo";
import { useNewEntry } from "./useNewEntry";
import { useRename } from "./useRename";
import { useTreeTransfer } from "./useTreeTransfer";
import type { TreeSelection } from "./tree-selection";

/** The tree's own changes to its folder: entries named and renamed in
 *  place, rows moved and copied, and the undo stack every operation
 *  records in (its one owner). */
export function useTreeEdits(input: {
  treeRef: RefObject<HTMLDivElement | null>;
  /** The folder the tree shows. */
  folder: string;
  t: Strings;
  reload: (...dirs: string[]) => void;
  onFileSelect: (path: string) => void;
  onEntryMoved: (from: string, to: string) => void;
  selection: TreeSelection;
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
  const { transfer } = useTreeTransfer({
    folder,
    t,
    reload,
    onEntryMoved: input.onEntryMoved,
    fileUndo,
    selection: input.selection,
  });
  return { fileUndo, transfer, ...naming, ...renaming };
}
