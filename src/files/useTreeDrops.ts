import type { RefObject } from "react";
import type { Strings } from "../i18n/strings";
import { useRowDrag } from "./useRowDrag";
import { useTreeFileDrop } from "./useTreeFileDrop";
import { scrollRowIntoView } from "./tree-reveal";
import type { TreeSelection } from "./tree-selection";
import { useFileUndo } from "./useFileUndo";

/**
 * What is dragged onto the tree: its own rows, moved (useRowDrag), and
 * files from a file manager with a folder open, copied in
 * (useTreeFileDrop), the first copy picked and its row shown. `into`: the
 * folder lit under either. A drop can be taken back (useFileUndo).
 */
export function useTreeDrops(input: {
  treeRef: RefObject<HTMLDivElement | null>;
  /** The folder open in the window, or null. */
  folder: string | null;
  /** The folder whose documents' links follow a move. */
  linkBase: string;
  reload: (...dirs: string[]) => void;
  onEntryMoved: (from: string, to: string) => void;
  t: Strings;
  selection: TreeSelection;
  onHeld: (at: { x: number; y: number }, path: string, isDir: boolean) => void;
}) {
  const { treeRef, folder, reload, selection } = input;
  const { drag, onRowPointerDown } = useRowDrag(
    treeRef,
    reload,
    input.onEntryMoved,
    input.linkBase,
    input.t,
    selection,
    input.onHeld,
  );
  // What a drop did, to take back (the tree's undo stack, its one owner).
  const fileUndo = useFileUndo(treeRef, input.linkBase, reload);
  const fromSystem = useTreeFileDrop(
    treeRef,
    folder,
    reload,
    (path, isDir) => {
      selection.only({ path, isDir });
      // The keyboard on it: Edit › Undo then takes the drop back.
      scrollRowIntoView(treeRef.current, path, true);
    },
    fileUndo.record,
  );
  return {
    drag,
    onRowPointerDown,
    into: drag?.into ?? fromSystem,
  };
}
