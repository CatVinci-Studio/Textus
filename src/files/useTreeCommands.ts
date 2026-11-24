import {
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { drawHeldRows } from "../engine/controls/useTreeKeys";
import { isMacPlatform } from "../platform/os";
import { FOCUSED_EDIT_EVENT } from "../utils/events";
import { useLatest } from "../utils/hooks/useLatest";
import { comboFromEvent } from "../utils/shortcuts";
import { shownRows, type TreeRow, type TreeSelection } from "./tree-selection";

/** What a key does to the tree's rows. */
type TreeCommand =
  "rename" | "open" | "trash" | "selectAll" | "extendUp" | "extendDown";

const EVERYWHERE: Record<string, TreeCommand> = {
  f2: "rename",
  "mod+a": "selectAll",
  "shift+arrowup": "extendUp",
  "shift+arrowdown": "extendDown",
};

/** As each system's file manager has them: a Mac's Finder renames with
 *  Return and opens with ⌘↓; Explorer and Linux's open with Enter. */
const KEYS: Record<"mac" | "other", Record<string, TreeCommand>> = {
  mac: {
    ...EVERYWHERE,
    enter: "rename",
    "mod+arrowdown": "open",
    "mod+backspace": "trash",
    delete: "trash",
  },
  other: { ...EVERYWHERE, enter: "open", delete: "trash" },
};

/** The rows on screen, top to bottom. */
function visibleRows(tree: HTMLElement): HTMLElement[] {
  return [
    ...tree.querySelectorAll<HTMLElement>('[role="treeitem"][data-path]'),
  ].filter((el) => el.getClientRects().length > 0);
}

const rowOfEvent = (e: { target: EventTarget | null }) => {
  const el = e.target as HTMLElement | null;
  return el?.getAttribute?.("role") === "treeitem" && el.dataset.path
    ? el
    : null;
};

/**
 * The tree's keys for its rows, from one table: rename, open, move to the
 * Trash (the picked rows, if the row is one of them), select all, and
 * Shift with an arrow to pick a range. Select All on a Mac comes from its
 * menu through FOCUSED_EDIT_EVENT. Returns the tree's keydown, true when
 * a key was one of them.
 */
export function useTreeCommands(input: {
  treeRef: RefObject<HTMLDivElement | null>;
  selection: TreeSelection;
  rename: (path: string) => void;
  /** A document in a tab of its own. */
  open: (path: string) => void;
  /** Asks, then moves the rows to the Trash. */
  trash: (rows: readonly TreeRow[]) => void;
}) {
  const latest = useLatest(input);

  const run = (command: TreeCommand, row: HTMLElement): void => {
    const { treeRef, selection, rename, open, trash } = latest.current;
    const tree = treeRef.current;
    if (!tree) return;
    const path = row.dataset.path!;
    const isDir = row.hasAttribute("aria-expanded");
    switch (command) {
      case "rename":
        return rename(path);
      case "open":
        // A folder opens as a click would: folded or unfolded.
        return isDir ? row.click() : open(path);
      case "trash":
        return trash(selection.groupOf(path) ?? [{ path, isDir }]);
      case "selectAll":
        // Rows a big folder held back are rows too.
        drawHeldRows(tree);
        return selection.selectAll(shownRows(tree));
      case "extendUp":
      case "extendDown": {
        const rows = visibleRows(tree);
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
      if ((e as CustomEvent<string>).detail !== "select-all" || !row) return;
      e.preventDefault();
      run("selectAll", row);
    };
    tree.addEventListener(FOCUSED_EDIT_EVENT, onEdit);
    return () => tree.removeEventListener(FOCUSED_EDIT_EVENT, onEdit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run reads latest
  }, [input.treeRef]);

  return (e: ReactKeyboardEvent<HTMLElement>): boolean => {
    const row = rowOfEvent(e);
    const keys = KEYS[isMacPlatform() ? "mac" : "other"];
    const command = row && keys[comboFromEvent(e.nativeEvent) ?? ""];
    if (!row || !command) return false;
    e.preventDefault();
    e.stopPropagation();
    run(command, row);
    return true;
  };
}
