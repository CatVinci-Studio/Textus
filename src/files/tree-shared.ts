import { fill } from "../i18n/fill";
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
import { errorCode } from "../utils/error-text";

// What the file tree and its rows share.

/** The tree's order: by name, folders first, or newest first. */
export type TreeSort = "name" | "modified";

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
  /** Bumped when the window comes back to the front: every open folder is
   *  read again, as another app may have changed it. */
  refreshed: number;
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
  /** A new document or folder being named in place, in `dir`. */
  draft: TreeDraft | null;
  /** Its name, or null when it was given up. */
  finishDraft: (name: string | null) => void;
  /** An empty folder's one button: a new document named in place there,
   *  with its label. Null where documents aren't made here. */
  newDocument: { label: string; start: () => void } | null;
  /** A folder to bring into view: it and those above it open. */
  reveal: string | null;
}

export interface TreeDraft {
  dir: string;
  kind: "document" | "folder";
}

export const TreeContext = createContext<TreeShared | null>(null);

/** What a file's row reads: the actions alone, which keep while the
 *  folders are read again, so a re-read doesn't draw every row. */
export type TreeRowActions = Pick<
  TreeShared,
  "onRowMenu" | "onRowPointerDown" | "openInNewWindow"
>;

export const TreeRowActionsContext = createContext<TreeRowActions | null>(null);

export function useTreeRowActions(): TreeRowActions {
  const actions = useContext(TreeRowActionsContext);
  if (!actions) throw new Error("FileTree rows render inside a FileTree");
  return actions;
}

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
  if (errorCode(reason) === "exists") return fill(t.treeNameTaken, { name });
  return fill(t.treeActionFailed, { reason: explainError(err, t) });
}

/** How a file chosen in the sidebar opens: to look (a click, the preview
 *  tab), beside the one in front, or (none) in a tab of its own. */
export type FileOpenHow = "preview" | "beside";
