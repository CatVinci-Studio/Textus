import {
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { drawHeldRows, visibleItems } from "../engine/controls/useTreeKeys";
import { hasNativeMenuBar } from "../platform/capabilities";
import { isMacPlatform } from "../platform/os";
import { FOCUSED_EDIT_EVENT } from "../utils/events";
import { useLatest } from "../utils/hooks/useLatest";
import { comboFromEvent } from "../utils/shortcuts";
import {
  rowOfEvent,
  shownRows,
  type TreeRow,
  type TreeSelection,
} from "./tree-selection";
import type { TreeClipboard } from "./useTreeClipboard";
import type { FileUndo } from "./useFileUndo";

/** What a key does to the tree's rows. */
type TreeCommand =
  | "rename"
  | "open"
  | "trash"
  | "selectAll"
  | "extendUp"
  | "extendDown"
  | "cut"
  | "copy"
  | "paste"
  | "duplicate"
  | "undo"
  | "redo";

const EVERYWHERE: Record<string, TreeCommand> = {
  f2: "rename",
  "mod+a": "selectAll",
  "shift+arrowup": "extendUp",
  "shift+arrowdown": "extendDown",
  "mod+d": "duplicate",
};

/** Undo and Redo from the keys where no menu of the system's takes them:
 *  a Mac's menu bar does, and comes back through FOCUSED_EDIT_EVENT. */
const UNDO_KEYS: Record<string, TreeCommand> = hasNativeMenuBar
  ? {}
  : { "mod+z": "undo", "mod+shift+z": "redo", "mod+y": "redo" };

/** The Edit menu's items that reach the tree through FOCUSED_EDIT_EVENT. */
const EDIT_ITEMS: Record<string, TreeCommand> = {
  undo: "undo",
  redo: "redo",
  "select-all": "selectAll",
};

/** As each system's file manager has them: a Mac's Finder renames with
 *  Return and opens with ⌘↓; Explorer and Linux's open with Enter. A Mac's
 *  Cut, Copy and Paste come through its Edit menu (useTreeClipboard.ts). */
const KEYS: Record<"mac" | "other", Record<string, TreeCommand>> = {
  mac: {
    ...EVERYWHERE,
    ...UNDO_KEYS,
    enter: "rename",
    "mod+arrowdown": "open",
    "mod+backspace": "trash",
    delete: "trash",
  },
  other: {
    ...EVERYWHERE,
    ...UNDO_KEYS,
    enter: "open",
    delete: "trash",
    "mod+x": "cut",
    "mod+c": "copy",
    "mod+v": "paste",
  },
};

/**
 * The tree's keys for its rows, from one table: rename, open, move to the
 * Trash, cut, copy, paste and duplicate (the picked rows, if the row is one
 * of them), select all, Shift with an arrow to pick a range, and undo and
 * redo the tree's file operations. The Edit menu's Undo, Redo and Select
 * All come through FOCUSED_EDIT_EVENT. Returns the tree's keydown, true
 * when a key was one of them.
 */
export function useTreeCommands(input: {
  treeRef: RefObject<HTMLDivElement | null>;
  selection: TreeSelection;
  rename: (path: string) => void;
  /** A document in a tab of its own. */
  open: (path: string) => void;
  /** Asks, then moves the rows to the Trash. */
  trash: (rows: readonly TreeRow[]) => void;
  clip: TreeClipboard;
  /** Takes back or does again the tree's last file operation; false when
   *  there is none. */
  undo: FileUndo["act"];
}) {
  const latest = useLatest(input);

  /** False when the command had nothing to do, the key left to others. */
  const run = (command: TreeCommand, row: HTMLElement): boolean | void => {
    const { treeRef, selection, rename, open, trash, clip, undo } =
      latest.current;
    const tree = treeRef.current;
    if (!tree) return;
    const path = row.dataset.path!;
    const isDir = row.hasAttribute("aria-expanded");
    switch (command) {
      case "undo":
        return undo.undo();
      case "redo":
        return undo.redo();
      case "rename":
        return rename(path);
      case "open":
        // A folder opens as a click would: folded or unfolded.
        return isDir ? row.click() : open(path);
      case "trash":
        return trash(selection.rowsFor(path, isDir));
      case "cut":
      case "copy":
        return clip.cutOrCopy(
          selection.rowsFor(path, isDir),
          command === "cut",
        );
      case "paste":
        return void clip.paste(clip.pasteInto(row));
      case "duplicate":
        return clip.duplicate(selection.rowsFor(path, isDir));
      case "selectAll":
        // Rows a big folder held back are rows too.
        drawHeldRows(tree);
        return selection.selectAll(shownRows(tree));
      case "extendUp":
      case "extendDown": {
        const rows = visibleItems(tree);
        const next =
          rows[rows.indexOf(row) + (command === "extendUp" ? -1 : 1)];
        if (!next) return;
        selection.extend(path, next.dataset.path!, shownRows(tree));
        next.focus();
      }
    }
  };

  useEffect(() => {
    const tree = input.treeRef.current;
    if (!tree) return;
    const onEdit = (e: Event) => {
      const row = rowOfEvent(e);
      const command = EDIT_ITEMS[(e as CustomEvent<string>).detail];
      if (row && command && run(command, row) !== false) e.preventDefault();
    };
    tree.addEventListener(FOCUSED_EDIT_EVENT, onEdit);
    return () => tree.removeEventListener(FOCUSED_EDIT_EVENT, onEdit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run reads latest
  }, [input.treeRef]);

  return (e: ReactKeyboardEvent<HTMLElement>): boolean => {
    const row = rowOfEvent(e);
    const keys = KEYS[isMacPlatform() ? "mac" : "other"];
    const command = row && keys[comboFromEvent(e.nativeEvent) ?? ""];
    if (!row || !command || run(command, row) === false) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };
}
