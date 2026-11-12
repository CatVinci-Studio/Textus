import { useCallback, useEffect, useState } from "react";

import { isInside, parentDir } from "../utils/path";
import { FILE_WRITTEN_EVENT } from "../utils/events";
import { type SearchScope } from "./file-search";
import { getUiState } from "../storage/ui-state";
import { type TreeSort } from "./tree-shared";

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
export function useTreeView(base: string) {
  const [generation, setGeneration] = useState(0);
  const [sort, setSort] = useState<TreeSort>(savedSort);
  const [scope, setScope] = useState<SearchScope>(savedScope);
  const [showHidden, setShowHidden] = useState(
    () => getUiState("fileTreeHidden") === "1",
  );
  const [versions, setVersions] = useState<Record<string, number>>({});
  const reload = useCallback((...dirs: string[]) => {
    setVersions((prev) => bump(prev, dirs));
  }, []);
  const [stale, setStale] = useState<Record<string, number>>({});
  const refresh = useCallback((dirs: string[]) => {
    setStale((prev) => bump(prev, dirs));
  }, []);
  usePluginWrites(base, refresh);
  const refreshed = useRefreshOnFocus();
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
    stale,
    refresh,
    refreshed,
  };
}

/** A count bumped each time the window comes back to the front, when Git,
 *  Obsidian or a file manager may have changed the folder. */
function useRefreshOnFocus(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const onFocus = () => setCount((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return count;
}

function bump(counts: Record<string, number>, dirs: string[]) {
  const next = { ...counts };
  for (const dir of dirs) next[dir] = (next[dir] ?? 0) + 1;
  return next;
}

/** What a plugin wrote, moved or trashed shows in the folders it touched,
 *  read again together a moment later. `base` is the opened folder, which a
 *  plugin's relative paths are in. */
function usePluginWrites(base: string, refresh: (dirs: string[]) => void) {
  useEffect(() => {
    const dirs = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWritten = (e: Event) => {
      const path = (e as CustomEvent<unknown>).detail;
      if (typeof path !== "string") return;
      const sep = base.includes("\\") ? "\\" : "/";
      const full = /^([\\/]|[A-Za-z]:)/.test(path)
        ? path
        : `${base.replace(/[\\/]+$/, "")}${sep}${path}`;
      for (
        let dir = parentDir(full);
        dir && (dir === base || isInside(dir, base));
        dir = parentDir(dir)
      )
        dirs.add(dir);
      clearTimeout(timer);
      timer = setTimeout(() => {
        refresh([...dirs]);
        dirs.clear();
      }, 150);
    };
    window.addEventListener(FILE_WRITTEN_EVENT, onWritten);
    return () => {
      window.removeEventListener(FILE_WRITTEN_EVENT, onWritten);
      clearTimeout(timer);
    };
  }, [base, refresh]);
}
