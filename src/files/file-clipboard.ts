import { useSyncExternalStore } from "react";
import { createSubscribers } from "../utils/store";
import { isWithin } from "../utils/path";
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
