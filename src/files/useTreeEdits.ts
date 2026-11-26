import { useState, type RefObject } from "react";
import type { Strings } from "../i18n/strings";
import { useFileUndo } from "./useFileUndo";
import { useNewEntry } from "./useNewEntry";
import { Renaming, useRename } from "./useRename";
import { useTreeTidy } from "./useTreeTidy";
import { useTreeTransfer } from "./useTreeTransfer";
import type { TreeSelection } from "./tree-selection";

/** The tree's own changes to its folder: entries named and renamed in
 *  place, rows moved and copied, each recorded to undo; the paths the tree
 *  holds follow them (useTreeTidy). */
export function useTreeEdits(input: {
  treeRef: RefObject<HTMLDivElement | null>;
  /** The folder the tree shows. */
  folder: string;
  t: Strings;
  reload: (...dirs: string[]) => void;
  onFileSelect: (path: string) => void;
  onEntryMoved: (from: string, to: string) => void;
  selection: TreeSelection;
  /** Changes whenever a folder of the tree is read again. */
  reread: unknown;
}) {
  const { treeRef, folder, t, reload, selection } = input;
  const [renaming] = useState(() => new Renaming());
  const onEntryMoved = useTreeTidy(
    { selection, renaming },
    input.onEntryMoved,
    input.reread,
  );
  const fileUndo = useFileUndo(treeRef, folder, reload, onEntryMoved);
  const naming = useNewEntry(t, reload, input.onFileSelect, fileUndo);
  const renamed = useRename({
    linkBase: folder,
    t,
    reload,
    onEntryMoved,
    fileUndo,
    renaming,
  });
  const { transfer } = useTreeTransfer({
    folder,
    t,
    reload,
    onEntryMoved,
    fileUndo,
    selection,
  });
  return { fileUndo, transfer, ...naming, ...renamed };
}
