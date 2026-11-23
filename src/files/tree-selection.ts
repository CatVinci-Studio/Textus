import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useLatestCallback } from "../utils/hooks/useLatest";
import { createSubscribers } from "../utils/store";
import { useTreeKeys } from "../engine/controls/useTreeKeys";
import { isMacPlatform } from "../platform/os";
import { isInside } from "../utils/path";

/** What a click with a modifier does to the tree's selection. */
type PickHow = "toggle" | "range";

/** A row of the tree: a file's or a folder's. */
export interface TreeRow {
  path: string;
  isDir: boolean;
}

/** The modifier a click carries: ⌘ on a Mac (Ctrl-click is its right
 *  click), Ctrl elsewhere, Shift for a range; null for a plain click. */
function pickHow(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): PickHow | null {
  if (e.shiftKey) return "range";
  return (isMacPlatform() ? e.metaKey : e.ctrlKey) ? "toggle" : null;
}

/**
 * The rows picked together in the file tree (⌘/Ctrl- and Shift-clicks), in
 * the order they were picked. Its one owner is the tree; a row reads only
 * whether it is in it, so a pick draws again the rows it changed alone.
 */
export class TreeSelection {
  private rows: readonly TreeRow[] = [];
  /** Where a Shift-click's range starts: the row last clicked. */
  private anchor: string | null = null;
  private readonly listeners = createSubscribers();

  subscribe = this.listeners.subscribe;

  has = (path: string): boolean => this.rows.some((row) => row.path === path);

  get size(): number {
    return this.rows.length;
  }

  /** A plain click: the row is where the next range starts, and nothing
   *  stays picked. */
  clickedPlain(path: string): void {
    this.anchor = path;
    this.set([]);
  }

  /**
   * A modified click on `path`. `shown` are the tree's rows in the order
   * shown and `open` the open document's, which a first ⌘-click picks along
   * with the row, as it already looks picked.
   */
  pick(
    how: PickHow,
    path: string,
    shown: readonly TreeRow[],
    open: string | null,
  ): void {
    const at = (p: string | null) => shown.findIndex((row) => row.path === p);
    const to = at(path);
    if (to === -1) return;
    const start = this.rows.length || at(open) === -1 ? null : open;
    if (how === "toggle") {
      const now = this.rows.length
        ? this.rows
        : shown.filter((row) => row.path === start && start !== path);
      this.set(
        this.has(path)
          ? now.filter((row) => row.path !== path)
          : [...now, shown[to]!],
      );
      this.anchor = path;
      return;
    }
    const from = at(this.anchor ?? start);
    const [a, b] =
      from === -1 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
    this.set(shown.slice(a, b + 1));
  }

  clear(): void {
    this.set([]);
  }

  /** `row` alone picked, and where the next range starts: what was just
   *  made (copied in), shown as the one row in hand. */
  only(row: TreeRow): void {
    this.anchor = row.path;
    this.set([row]);
  }

  /** The picked rows, if `path` is one of two or more; else none. */
  groupOf(path: string): readonly TreeRow[] | null {
    return this.rows.length > 1 && this.has(path) ? this.rows : null;
  }

  private set(next: readonly TreeRow[]): void {
    if (
      next.length === this.rows.length &&
      next.every((row, i) => row.path === this.rows[i]!.path)
    )
      return;
    this.rows = next;
    this.listeners.publish();
  }
}

/** The tree's rows walked by keys and picked by clicks: its selection, none
 *  once it shows another folder, whether any rows are picked, a row's click
 *  handed to it (true: it picked), and the tree's keys, Escape letting the
 *  picked rows go. */
export function useTreeSelection(root: string, activePath: string | null) {
  const { ref: treeRef, onKeyDown } = useTreeKeys<HTMLDivElement>();
  const [selection] = useState(() => new TreeSelection());
  const picking = useSyncExternalStore(
    selection.subscribe,
    () => selection.size > 0,
  );
  useEffect(() => selection.clear(), [selection, root]);
  const onRowPick = useLatestCallback((e: ReactMouseEvent, path: string) => {
    const how = pickHow(e);
    if (!how) {
      selection.clickedPlain(path);
      return false;
    }
    selection.pick(how, path, shownRows(treeRef.current), activePath);
    return true;
  });
  const onTreeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && picking) {
      e.stopPropagation();
      return selection.clear();
    }
    onKeyDown(e);
  };
  return { treeRef, onTreeKey, selection, picking, onRowPick };
}

export const TreeSelectionContext = createContext<TreeSelection | null>(null);

/** Whether the row of `path` is picked. */
export function useRowPicked(path: string): boolean {
  const selection = useContext(TreeSelectionContext);
  return useSyncExternalStore(
    selection?.subscribe ?? noSubscribe,
    () => selection?.has(path) ?? false,
  );
}

const noSubscribe = () => () => {};

/** The tree's rows in the order shown: its folders' rows are drawn as they
 *  are opened and come near, so the page holds that order. */
function shownRows(tree: HTMLElement | null): TreeRow[] {
  return [
    ...(tree?.querySelectorAll<HTMLElement>("[role=treeitem][data-path]") ??
      []),
  ].map((row) => ({
    path: row.dataset.path!,
    isDir: row.hasAttribute("aria-expanded"),
  }));
}

/** `rows` less any inside another of them: what moving or trashing them
 *  touches, a picked folder taking what is in it along. */
export function outermost(rows: readonly TreeRow[]): TreeRow[] {
  return rows.filter(
    (row) =>
      !rows.some((other) => other !== row && isInside(row.path, other.path)),
  );
}
