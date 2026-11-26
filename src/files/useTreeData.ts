import { useCallback, useEffect, useState } from "react";

import { absoluteIn, isInside, parentDir } from "../utils/path";
import { FILE_CREATED_EVENT, FILE_WRITTEN_EVENT } from "../utils/events";
import { type SearchScope } from "./file-search";
import { getUiState } from "../storage/ui-state";
import { type TreeSort } from "./tree-shared";
import { OpenFolders, useDiskWatch } from "./useDiskWatch";

/** What the file tree shows - its order, its filter, the folders' contents -
 *  and keeping it fresh as files change on disk, from plugins or elsewhere. */

function savedSort(): TreeSort {
  return getUiState("fileTreeSort") === "modified" ? "modified" : "name";
}

function savedScope(): SearchScope {
  return getUiState("fileSearchScope") === "documents" ? "documents" : "all";
}

/** What the tree shows: its sort, its scope (every file or documents), and
 *  `generation`, bumped by Refresh to remount every node and re-index.
 *  `reload` re-reads only the folders named and opens them; `refresh`
 *  re-reads them as they are. */
/** A count per folder, bumped for the folders given. */
function useFolderCounts() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const bumpAll = useCallback((...dirs: string[]) => {
    setCounts((prev) => bump(prev, dirs));
  }, []);
  return [counts, bumpAll] as const;
}

export function useTreeView(base: string) {
  const [generation, setGeneration] = useState(0);
  const [sort, setSort] = useState<TreeSort>(savedSort);
  const [scope, setScope] = useState<SearchScope>(savedScope);
  const [showHidden, setShowHidden] = useState(
    () => getUiState("fileTreeHidden") === "1",
  );
  const [versions, reload] = useFolderCounts();
  const changes = useFolderChanges(base);
  // Collapse All: every folder below the root folds, as `versions` stood.
  const [collapsed, setCollapsed] = useState<Record<string, number>>({});
  const collapseAll = useCallback(
    () => setCollapsed({ ...versions }),
    [versions],
  );
  return {
    generation,
    setGeneration,
    sort,
    setSort,
    scope,
    setScope,
    showHidden,
    setShowHidden,
    versions,
    reload,
    ...changes,
    collapsed,
    collapseAll,
  };
}

/** What changed the folders apart from the tree's own doing - another
 *  app on disk, a plugin - and the folders open, which the disk watch
 *  follows. */
function useFolderChanges(base: string) {
  const [stale, refresh] = useFolderCounts();
  usePluginWrites(base, refresh);
  const [openFolders] = useState(() => new OpenFolders());
  const refreshed = useDiskWatch(openFolders, refresh);
  return { stale, refresh, refreshed, openFolders };
}

function bump(counts: Record<string, number>, dirs: string[]) {
  const next = { ...counts };
  for (const dir of dirs) next[dir] = (next[dir] ?? 0) + 1;
  return next;
}

/** What a plugin wrote, moved or trashed, and a picture the app saved,
 *  shows in the folders it touched,
 *  read again together a moment later. `base` is the opened folder, which a
 *  plugin's relative paths are in. */
function usePluginWrites(base: string, refresh: (...dirs: string[]) => void) {
  useEffect(() => {
    const dirs = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWritten = (e: Event) => {
      const path = (e as CustomEvent<unknown>).detail;
      if (typeof path !== "string") return;
      const full = absoluteIn(base, path);
      for (
        let dir = parentDir(full);
        dir && (dir === base || isInside(dir, base));
        dir = parentDir(dir)
      )
        dirs.add(dir);
      clearTimeout(timer);
      timer = setTimeout(() => {
        refresh(...dirs);
        dirs.clear();
      }, 150);
    };
    window.addEventListener(FILE_WRITTEN_EVENT, onWritten);
    window.addEventListener(FILE_CREATED_EVENT, onWritten);
    return () => {
      window.removeEventListener(FILE_WRITTEN_EVENT, onWritten);
      window.removeEventListener(FILE_CREATED_EVENT, onWritten);
      clearTimeout(timer);
    };
  }, [base, refresh]);
}
