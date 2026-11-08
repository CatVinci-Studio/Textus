import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { fs } from "../platform/ipc";

import { basename, isInside, parentDir } from "../utils/path";
import { FILE_WRITTEN_EVENT } from "../utils/events";
import { type ContextMenuItem } from "../ui/ContextMenu";
import { contributedContextItems } from "../ui/context-menu-items";
import { type SearchScope } from "./file-search";
import { getUiState } from "../storage/ui-state";
import { showConfirm, showMessage, showPrompt } from "../ui/app-dialog";
import type { Strings } from "../i18n/strings";
import { failureText, type TreeDraft, type TreeSort } from "./tree-shared";
import { updateLinksAfterMove } from "./move-links";
import "./FileTree.css";
import { copyPathItem } from "../clipboard/copy-path";
import type { FileOpenHow } from "./tree-shared";

function savedSort(): TreeSort {
  return getUiState("fileTreeSort") === "modified" ? "modified" : "name";
}

function savedScope(): SearchScope {
  return getUiState("fileSearchScope") === "documents" ? "documents" : "all";
}

/** The file tree's hooks: what it shows, keeping it fresh, its rows' menu
 *  and a new entry being named. */

/** What the tree shows: its sort, the search's query and scope, and
 *  `generation`, bumped by Refresh to remount every node and re-index.
 *  `reload` re-reads only the folders named and opens them; `refresh`
 *  re-reads them as they are. */
export function useTreeView(base: string) {
  const [generation, setGeneration] = useState(0);
  const [query, setQuery] = useState("");
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
    query,
    setQuery,
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
export function useRefreshOnFocus(): number {
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
export function usePluginWrites(
  base: string,
  refresh: (dirs: string[]) => void,
) {
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

type TreeMenu = {
  x: number;
  y: number;
  items: (ContextMenuItem | "separator")[];
} | null;

/** The tree's menus: the one open, and a row's context menu - open, new
 *  document or folder, rename, move to Trash. */
export function useRowMenu(
  root: string,
  linkBase: string,
  t: Strings,
  reload: (...dirs: string[]) => void,
  onFileSelect: (path: string, how?: FileOpenHow) => void,
  onEntryMoved: (from: string, to: string) => void,
  setDraft: (draft: TreeDraft) => void,
) {
  const [menu, setMenu] = useState<TreeMenu>(null);
  const rename = useCallback(
    async (path: string) => {
      const name = await showPrompt(t.treeRenamePrompt, basename(path), {
        okLabel: t.treeRename,
        cancelLabel: t.cancel,
      });
      if (!name?.trim() || name.trim() === basename(path)) return;
      try {
        const to = await fs.renameEntry(path, name);
        reload(parentDir(path) ?? root);
        // Open documents follow, as for a move.
        onEntryMoved(path, to);
        void updateLinksAfterMove(path, to, linkBase, t);
      } catch (err) {
        await showMessage(failureText(t, err, name.trim()));
      }
    },
    [root, linkBase, t, reload, onEntryMoved],
  );
  const trash = useCallback(
    async (path: string, isDir: boolean) => {
      const name = basename(path);
      const ok = await showConfirm(
        (isDir ? t.treeTrashFolderConfirm : t.treeTrashConfirm).replace(
          "{name}",
          name,
        ),
        { okLabel: t.treeTrash, cancelLabel: t.cancel, danger: true },
      );
      if (!ok) return;
      try {
        await fs.trashEntry(path, root);
        reload(parentDir(path) ?? root);
      } catch (err) {
        await showMessage(failureText(t, err, name));
      }
    },
    [root, t, reload],
  );

  const onRowMenu = useCallback(
    (e: ReactMouseEvent, path: string, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      // New things go into the folder clicked, or the one the file is in.
      const dir = isDir ? path : (parentDir(path) ?? root);
      const items: (ContextMenuItem | "separator")[] = [];
      if (path !== root && !isDir)
        items.push(
          { label: t.treeOpen, onSelect: () => onFileSelect(path) },
          { label: t.openBeside, onSelect: () => onFileSelect(path, "beside") },
          "separator",
        );
      items.push(
        {
          label: t.treeNewDocument,
          onSelect: () => setDraft({ dir, kind: "document" }),
        },
        {
          label: t.treeNewFolder,
          onSelect: () => setDraft({ dir, kind: "folder" }),
        },
      );
      items.push("separator", copyPathItem(t, path));
      if (path !== root)
        items.push(
          { label: t.treeRenameItem, onSelect: () => void rename(path) },
          {
            label: t.treeTrashItem,
            onSelect: () => void trash(path, isDir),
            danger: true,
          },
        );
      const added = contributedContextItems("file/context", { path });
      if (added.length) items.push("separator", ...added);
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [root, t, setDraft, rename, trash, onFileSelect],
  );
  return { menu, setMenu, onRowMenu };
}

/** The document or folder being named in place, and making it once
 *  named (a document opens). */
export function useNewEntry(
  t: Strings,
  reload: (...dirs: string[]) => void,
  onFileSelect: (path: string) => void,
) {
  const [draft, setDraft] = useState<TreeDraft | null>(null);
  const finishDraft = useCallback(
    async (name: string | null) => {
      setDraft(null);
      if (!draft || !name) return;
      try {
        const made =
          draft.kind === "document"
            ? await fs.createDocument(draft.dir, name)
            : await fs.createFolder(draft.dir, name);
        reload(draft.dir);
        if (draft.kind === "document") onFileSelect(made);
      } catch (err) {
        await showMessage(failureText(t, err, name));
      }
    },
    [draft, t, reload, onFileSelect],
  );
  return { draft, setDraft, finishDraft };
}
