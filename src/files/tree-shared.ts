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
import { fs } from "../platform/ipc";
import { canTrashFiles } from "../platform/capabilities";
import { farEntries } from "../platform/far-files";
import { emitPluginEvent } from "../plugins/app-bridge";
import { ENTRY_TRASHED_EVENT, sendAppEvent } from "../utils/events";

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
  /** A right-click (a computer's, or an iPad's trackpad). */
  onRowMenu:
    ((e: ReactMouseEvent, path: string, isDir: boolean) => void) | null;
  /** A press: a mouse's drag, or a finger held still to lift the row and
   *  drag it, or let go in place for its menu. */
  onRowPointerDown:
    | ((
        e: ReactPointerEvent,
        path: string,
        name: string,
        isDir: boolean,
      ) => void)
    | null;
  /** A click on a row, which a ⌘/Ctrl or Shift makes a pick of several
   *  rows (tree-selection.ts): true when it was one. Desktop only. */
  onRowPick: ((e: ReactMouseEvent, path: string) => boolean) | null;
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
  "onRowMenu" | "onRowPointerDown" | "onRowPick"
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

/** The folder something let go at (x, y) over the tree `tree` goes into:
 *  a folder's row, a file's row's folder, the tree's own on its blank;
 *  null off the tree. `box`: the tree's box, if measured already. */
export function dropDirAt(
  tree: HTMLElement | null,
  x: number,
  y: number,
  box: DOMRect | null = tree?.getBoundingClientRect() ?? null,
): string | null {
  if (!tree || !box) return null;
  if (x < box.left || x > box.right || y < box.top || y > box.bottom)
    return null;
  const el = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-drop-dir]");
  return el && tree.contains(el) ? (el.dataset.dropDir ?? null) : null;
}

/** Whether `path` goes to a Trash; one in a phone's or a remote folder is
 *  deleted for good. */
export const trashable = (path: string) => canTrashFiles && !farEntries(path);

/** `path` to the Trash from the tree: its folder read again, its open tabs
 *  let go (useDocumentActions), plugins told. */
export async function trashFromTree(
  path: string,
  root: string,
  reload: (...dirs: string[]) => void,
): Promise<void> {
  await fs.trashEntry(path, root);
  reload(parentDir(path) ?? root);
  sendAppEvent(ENTRY_TRASHED_EVENT, path);
  emitPluginEvent("fileDelete", { path });
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
