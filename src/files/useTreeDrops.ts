import type { RefObject } from "react";
import { useRowDrag } from "./useRowDrag";
import { useTreeFileDrop } from "./useTreeFileDrop";
import { scrollRowIntoView } from "./tree-reveal";
import type { TreeSelection } from "./tree-selection";
import type { FileUndo } from "./useFileUndo";
import type { TreeTransfer } from "./useTreeTransfer";

/**
 * What is dragged onto the tree: its own rows, moved or copied
 * (useRowDrag), and
 * files from a file manager with a folder open, copied in
 * (useTreeFileDrop), the first copy picked and its row shown. `into`: the
 * folder lit under either. A drop can be taken back (useFileUndo).
 */
export function useTreeDrops(input: {
  treeRef: RefObject<HTMLDivElement | null>;
  /** The folder open in the window, or null. */
  folder: string | null;
  reload: (...dirs: string[]) => void;
  selection: TreeSelection;
  onHeld: (at: { x: number; y: number }, path: string, isDir: boolean) => void;
  /** The tree's undo, which keeps what a drop did. */
  fileUndo: FileUndo;
  /** Moves or copies the tree's own rows into a folder. */
  transfer: TreeTransfer["transfer"];
}) {
  const { treeRef, folder, reload, selection } = input;
  const { drag, onRowPointerDown } = useRowDrag(
    treeRef,
    selection,
    input.onHeld,
    input.transfer,
  );
  const fromSystem = useTreeFileDrop(
    treeRef,
    folder,
    reload,
    (path, isDir) => {
      selection.only({ path, isDir });
      // The keyboard on it: Edit › Undo then takes the drop back.
      scrollRowIntoView(treeRef.current, path, true);
    },
    input.fileUndo.record,
  );
  return {
    drag,
    onRowPointerDown,
    into: drag?.into ?? fromSystem,
  };
}
