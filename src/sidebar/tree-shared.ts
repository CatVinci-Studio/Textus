import {
  createContext,
  useContext,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SearchScope } from "./file-search";
import { isInside, parentDir } from "../utils/path";

// What the file tree (FileTree.tsx) and its rows (TreeNodes.tsx) share:
// the order, the context every row reads, and where a move may go.

/** The tree's order: by name, folders first, or newest first. */
export type TreeSort = "name" | "modified";

/** How far the pointer moves before a press on a row becomes a drag. */
export const DRAG_START_PX = 5;

/** What every row of the tree reads: the order and the filter, which
 *  folders to read again, and the desktop's right-click menu and drag. */
export interface TreeShared {
  sort: TreeSort;
  scope: SearchScope;
  /** Bumped per folder after something was made in it or moved in or out:
   *  that folder reads its entries again and opens. */
  versions: Record<string, number>;
  dropInto: string | null;
  /** Desktop only (null on iOS, where the long press has its own menu). */
  onRowMenu:
    ((e: ReactMouseEvent, path: string, isDir: boolean) => void) | null;
  onRowPointerDown:
    | ((
        e: ReactPointerEvent,
        path: string,
        name: string,
        isDir: boolean,
      ) => void)
    | null;
  /** True once, for the click that ends a drag. */
  takeDragClick: () => boolean;
}

export const TreeContext = createContext<TreeShared | null>(null);

export function useTree(): TreeShared {
  const shared = useContext(TreeContext);
  if (!shared) throw new Error("FileTree rows render inside a FileTree");
  return shared;
}

/** Where a move is allowed: not where it already is, and a folder not
 *  into itself or below it (commands/tree_ops.rs refuses the same). */
export function canMoveInto(
  path: string,
  isDir: boolean,
  into: string,
): boolean {
  if (parentDir(path) === into) return false;
  if (isDir && (into === path || isInside(into, path))) return false;
  return true;
}
