import { useEffect } from "react";
import { useLatestCallback } from "../utils/hooks/useLatest";
import { isWithin } from "../utils/path";
import { fs } from "../platform/ipc";
import { isFarUrl } from "../platform/far-files";
import { fileClipboard } from "./file-clipboard";
import type { TreeSelection } from "./tree-selection";

/** What the tree holds by path besides its rows: the picked rows, what
 *  was cut or copied, the row being renamed. */
interface Held {
  selection: TreeSelection;
  renaming: { path: string | null; set: (path: string | null) => void };
}

/**
 * The paths the tree holds kept true to the disk: a move (a drag, a paste,
 * a rename, an undo) takes them along, and once any folder is read again
 * (the tree's own change, another app's) those no longer there are let go.
 * Returns the move to call, `onEntryMoved` after it.
 */
export function useTreeTidy(
  held: Held,
  onEntryMoved: (from: string, to: string) => void,
  /** Changes whenever a folder of the tree is read again. */
  reread: unknown,
) {
  const { selection, renaming } = held;
  useEffect(() => {
    const paths = new Set([
      ...selection.paths,
      ...(fileClipboard.get()?.rows.map((row) => row.path) ?? []),
      ...(renaming.path ? [renaming.path] : []),
    ]);
    if (!paths.size) return;
    let stale = false;
    void (async () => {
      // Only what the disk says is gone: a plugin's folder can't say.
      const near = [...paths].filter(
        (path) => !isFarUrl(path) && !path.startsWith("content://"),
      );
      const times = await Promise.all(
        near.map((path) => fs.fileMtimeMs(path).catch(() => undefined)),
      );
      const gone = new Set(near.filter((_, i) => times[i] === null));
      if (stale || !gone.size) return;
      const kept = (path: string) => !gone.has(path);
      selection.keepOnly(kept);
      fileClipboard.keepOnly(kept);
      if (renaming.path && gone.has(renaming.path)) renaming.set(null);
    })();
    return () => {
      stale = true;
    };
  }, [reread, selection, renaming]);

  return useLatestCallback((from: string, to: string) => {
    selection.moved(from, to);
    fileClipboard.moved(from, to);
    if (renaming.path && isWithin(renaming.path, from)) renaming.set(null);
    onEntryMoved(from, to);
  });
}
