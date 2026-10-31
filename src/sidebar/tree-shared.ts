import {
  createContext,
  useContext,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SearchScope } from "./file-search";
import type { Strings } from "../i18n/strings";
import { isInside, parentDir } from "../utils/path";
import { explainError } from "../utils/error-explain";

// What the file tree and its rows share.

/** The tree's order: by name, folders first, or newest first. */
export type TreeSort = "name" | "modified";

/** How far the pointer moves before a press on a row becomes a drag. */
export const DRAG_START_PX = 5;

/** What every row of the tree reads: the order and the filter, which
 *  folders to read again, and the desktop's right-click menu and drag. */
export interface TreeShared {
  sort: TreeSort;
  scope: SearchScope;
  /** Hidden files shown too: a dot's, or Windows marked hidden. */
  showHidden: boolean;
  /** Bumped per folder after something was made in it or moved in or out:
   *  that folder reads its entries again and opens. */
  versions: Record<string, number>;
  /** Bumped per folder when something else changed it (a plugin's write):
   *  it reads its entries again if open, and stays as it is. */
  stale: Record<string, number>;
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
  /** ⌘/Ctrl-click on a file opens it in a window of its own. Desktop only. */
  openInNewWindow: ((path: string) => void) | null;
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
 *  into itself or below it. */
export function canMoveInto(
  path: string,
  isDir: boolean,
  into: string,
): boolean {
  if (parentDir(path) === into) return false;
  if (isDir && (into === path || isInside(into, path))) return false;
  return true;
}

/** The backend's refusal in the user's words. */
export function failureText(t: Strings, err: unknown, name: string): string {
  const reason = err instanceof Error ? err.message : String(err);
  if (reason.includes("Already exists"))
    return t.treeNameTaken.replace("{name}", name);
  return t.treeActionFailed.replace("{reason}", explainError(err, t));
}
