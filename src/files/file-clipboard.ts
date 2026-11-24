import { useSyncExternalStore } from "react";
import { createSubscribers } from "../utils/store";
import { isWithin, movedTo } from "../utils/path";
import type { TreeRow } from "./tree-selection";

/** Rows cut or copied in the file tree, to paste into a folder. */
interface Held {
  rows: readonly TreeRow[];
  /** Cut: pasting moves them; else it copies them. */
  cut: boolean;
}

/**
 * The tree's own clipboard for files (its one owner): what Cut or Copy
 * took, until it is pasted after a Cut or something else is taken. The
 * system's clipboard gets their paths as text alongside, for other apps.
 */
class FileClipboard {
  private held: Held | null = null;
  private readonly listeners = createSubscribers();
  subscribe = this.listeners.subscribe;

  get(): Held | null {
    return this.held;
  }

  set(held: Held | null): void {
    this.held = held?.rows.length ? held : null;
    this.listeners.publish();
  }

  /** `from` moved to `to`: what was taken at or under it follows. */
  moved(from: string, to: string): void {
    if (!this.held) return;
    const rows = this.held.rows.map((row) => {
      const path = movedTo(row.path, from, to);
      return path === null ? row : { ...row, path };
    });
    if (rows.some((row, i) => row !== this.held!.rows[i]))
      this.set({ ...this.held, rows });
  }

  /** Only the rows for which `kept` holds stay taken. */
  keepOnly(kept: (path: string) => boolean): void {
    if (!this.held) return;
    const rows = this.held.rows.filter((row) => kept(row.path));
    if (rows.length !== this.held.rows.length) this.set({ ...this.held, rows });
  }

  /** Whether `path` was cut, or is inside a folder that was. */
  isCut(path: string): boolean {
    return (
      !!this.held?.cut && this.held.rows.some((row) => isWithin(path, row.path))
    );
  }
}

export const fileClipboard = new FileClipboard();

/** The paths of `rows` as the system's clipboard gets them. */
export const pathsText = (rows: readonly TreeRow[]) =>
  rows.map((row) => row.path).join("\n");

/** Whether the row of `path` is cut, to show it faded until it moves. */
export function useRowCut(path: string): boolean {
  return useSyncExternalStore(fileClipboard.subscribe, () =>
    fileClipboard.isCut(path),
  );
}
