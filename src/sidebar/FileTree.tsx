import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { DirEntryInfo } from "../platform/fs-types";
import {
  ChevronIcon,
  CloseIcon,
  FolderIcon,
  FolderOpenIcon,
  OpenFolderIcon,
  RefreshIcon,
  SortIcon,
  fileIconFor,
} from "../ui/icons";
import { fs } from "../platform/ipc";
import { useSettings } from "../settings/SettingsContext";
import { basename, isInside, parentDir } from "../utils/path";
import { canOpenFolder, isIOSApp } from "../platform/capabilities";
import { iosFiles } from "../platform/ios-files";
import { ContextMenu, type ContextMenuItem } from "../editor/ContextMenu";
import { Presence } from "../ui/usePresence";
import { useLongPress } from "../utils/hooks/useLongPress";
import { useTreeKeys } from "../ui/useTreeKeys";
import { FileSearch } from "./FileSearch";
import { isDocumentName, type SearchScope } from "./file-search";
import { localeOf } from "../i18n/langs";
import { compareEntries, nameCollator } from "../utils/name-order";
import { Tooltip } from "../ui/Tooltip";
import { getUiState, setUiState } from "../storage/ui-state";
import { showMessage, showPrompt } from "../ui/app-dialog";
import type { Strings } from "../i18n/strings";
import "./FileTree.css";

/** The tree's order: by name, folders first, or newest first. */
export type TreeSort = "name" | "modified";

/** How far the pointer moves before a press on a row becomes a drag. */
const DRAG_START_PX = 5;

interface FileTreeProps {
  /** Where the tree is rooted (app/useOpenFolder.ts decides when the
   *  document in front moves it); the parent folder's name in the toolbar
   *  and double-clicking a folder move it through `onRootChange` without
   *  touching the open document. */
  root: string;
  onRootChange: (path: string) => void;
  /** The folder opened with File > Open Folder…, or null. The tree stays
   *  inside it, and the search covers all of it. */
  folder: string | null;
  activePath: string | null;
  onFileSelect: (path: string) => void;
  /** File > Open Folder… and Close Folder; Open is left out on iOS. */
  onOpenFolder?: () => void;
  onCloseFolder: () => void;
  /** A file or folder was dragged into another folder: open tabs follow
   *  it to its new path. */
  onEntryMoved: (from: string, to: string) => void;
  /** The search shortcut asked for the search box. */
  searchFocusRequest: boolean;
  onSearchFocusHandled: () => void;
}

/** A row being dragged, and the folder under the pointer. */
interface Drag {
  path: string;
  name: string;
  isDir: boolean;
  x: number;
  y: number;
  /** The folder it would go into; null over nowhere it can go. */
  into: string | null;
}

/** What every row of the tree reads: the order and the filter, which
 *  folders to read again, and the desktop's right-click menu and drag. */
interface TreeShared {
  sort: TreeSort;
  scope: SearchScope;
  /** Bumped per folder after something was made in it or moved in or out:
   *  that folder reads its entries again and opens. */
  versions: Record<string, number>;
  dropInto: string | null;
  /** Desktop only (null on iOS, where the long press has its own menu). */
  onRowMenu:
    ((e: ReactMouseEvent, path: string, isDir: boolean) => void) | null;
  onRowPointerDown:
    | ((
        e: ReactPointerEvent,
        path: string,
        name: string,
        isDir: boolean,
      ) => void)
    | null;
  /** True once, for the click that ends a drag. */
  takeDragClick: () => boolean;
}

const TreeContext = createContext<TreeShared | null>(null);

function useTree(): TreeShared {
  const shared = useContext(TreeContext);
  if (!shared) throw new Error("FileTree rows render inside a FileTree");
  return shared;
}

/** Where a move is allowed: not where it already is, and a folder not
 *  into itself or below it (commands/tree_ops.rs refuses the same). */
function canMoveInto(path: string, isDir: boolean, into: string): boolean {
  if (parentDir(path) === into) return false;
  if (isDir && (into === path || isInside(into, path))) return false;
  return true;
}

/** The backend's refusal in the user's words. */
function failureText(t: Strings, err: unknown, name: string): string {
  const reason = err instanceof Error ? err.message : String(err);
  if (reason.includes("Already exists"))
    return t.treeNameTaken.replace("{name}", name);
  return t.treeActionFailed.replace("{reason}", reason);
}

function savedSort(): TreeSort {
  return getUiState("fileTreeSort") === "modified" ? "modified" : "name";
}

function savedScope(): SearchScope {
  return getUiState("fileSearchScope") === "documents" ? "documents" : "all";
}

export function FileTree({
  root,
  onRootChange,
  folder,
  activePath,
  onFileSelect,
  onOpenFolder,
  onCloseFolder,
  onEntryMoved,
  searchFocusRequest,
  onSearchFocusHandled,
}: FileTreeProps) {
  const { t } = useSettings();
  // Bumped by Refresh: remounts every node so each re-reads its folder, and
  // the search indexes the folder again.
  const [generation, setGeneration] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TreeSort>(savedSort);
  const [scope, setScope] = useState<SearchScope>(savedScope);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: (ContextMenuItem | "separator")[];
  } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragClick = useRef(false);
  // Not on iOS: above Documents is the app's private container, and above
  // a folder picked in Files is outside what the user granted. Not above an
  // opened folder either: that is the edge of what the user opened.
  const parent = isIOSApp || root === folder ? null : parentDir(root);
  const searching = query.trim() !== "";
  const treeRef = useRef<HTMLDivElement>(null);
  const treeKeys = useTreeKeys(treeRef);
  const desktop = !isIOSApp && canOpenFolder;

  const reload = useCallback((...dirs: string[]) => {
    setVersions((prev) => {
      const next = { ...prev };
      for (const dir of dirs) next[dir] = (next[dir] ?? 0) + 1;
      return next;
    });
  }, []);

  const create = useCallback(
    async (dir: string, kind: "document" | "folder") => {
      const doc = kind === "document";
      const name = await showPrompt(
        doc ? t.treeNewDocumentPrompt : t.treeNewFolderPrompt,
        doc ? t.treeNewDocumentDefault : t.treeNewFolderDefault,
        { okLabel: t.dialogOk, cancelLabel: t.cancel },
      );
      if (!name?.trim()) return;
      try {
        const made = doc
          ? await fs.createDocument(dir, name)
          : await fs.createFolder(dir, name);
        reload(dir);
        if (doc) onFileSelect(made);
      } catch (err) {
        await showMessage(failureText(t, err, name.trim()));
      }
    },
    [t, reload, onFileSelect],
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
          "separator",
        );
      items.push(
        {
          label: t.treeNewDocument,
          onSelect: () => void create(dir, "document"),
        },
        { label: t.treeNewFolder, onSelect: () => void create(dir, "folder") },
      );
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [root, t, create, onFileSelect],
  );

  // A drag: a press on a row that moves past DRAG_START_PX. Pointer events
  // rather than HTML drag and drop, which the window's own file drop
  // (dragging files in from Finder or Explorer) takes over on Windows.
  const pressed = useRef<{
    path: string;
    name: string;
    isDir: boolean;
    x: number;
    y: number;
  } | null>(null);
  const onRowPointerDown = useCallback(
    (e: ReactPointerEvent, path: string, name: string, isDir: boolean) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      pressed.current = { path, name, isDir, x: e.clientX, y: e.clientY };
    },
    [],
  );
  useEffect(() => {
    const targetAt = (x: number, y: number, path: string, isDir: boolean) => {
      const el = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-drop-dir]");
      const into = el?.dataset.dropDir;
      return into &&
        treeRef.current?.contains(el) &&
        canMoveInto(path, isDir, into)
        ? into
        : null;
    };
    let current: Drag | null = null;
    const show = (next: Drag | null) => {
      current = next;
      setDrag(next);
    };
    const onMove = (e: PointerEvent) => {
      const start = pressed.current;
      if (!start) return;
      if (
        !current &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_START_PX
      )
        return;
      show({
        path: start.path,
        name: start.name,
        isDir: start.isDir,
        x: e.clientX,
        y: e.clientY,
        into: targetAt(e.clientX, e.clientY, start.path, start.isDir),
      });
    };
    const end = () => {
      pressed.current = null;
      const dropped = current;
      if (!dropped) return;
      show(null);
      dragClick.current = true;
      // A click may not follow (released outside the row).
      window.setTimeout(() => (dragClick.current = false), 0);
      if (dropped.into) void move(dropped.path, dropped.into);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !pressed.current) return;
      pressed.current = null;
      show(null);
    };
    const move = async (from: string, into: string) => {
      try {
        const to = await fs.moveEntry(from, into);
        reload(parentDir(from) ?? into, into);
        onEntryMoved(from, to);
      } catch (err) {
        await showMessage(failureText(t, err, basename(from)));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", onKey);
    };
  }, [reload, onEntryMoved, t]);

  const shared = useMemo<TreeShared>(
    () => ({
      sort,
      scope,
      versions,
      dropInto: drag?.into ?? null,
      onRowMenu: desktop ? onRowMenu : null,
      onRowPointerDown: desktop ? onRowPointerDown : null,
      takeDragClick: () => {
        const taken = dragClick.current;
        dragClick.current = false;
        return taken;
      },
    }),
    [sort, scope, versions, drag?.into, desktop, onRowMenu, onRowPointerDown],
  );

  const openSortMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const pick = (next: TreeSort) => () => {
      setSort(next);
      setUiState("fileTreeSort", next);
    };
    setMenu({
      x: box.left,
      y: box.bottom + 2,
      items: [
        {
          label: t.treeSortName,
          checked: sort === "name",
          onSelect: pick("name"),
        },
        {
          label: t.treeSortModified,
          checked: sort === "modified",
          onSelect: pick("modified"),
        },
      ],
    });
  };
  const changeScope = (next: SearchScope) => {
    setScope(next);
    setUiState("fileSearchScope", next);
  };

  return (
    <TreeContext.Provider value={shared}>
      <div className={`file-tree${drag ? " file-tree-dragging" : ""}`}>
        {/* Not on iOS (see canOpenFolder): its folders can be Files-app
          URLs, which the backend can't walk. */}
        {canOpenFolder && (
          <FileSearch
            root={folder ?? root}
            refreshKey={generation}
            query={query}
            onQueryChange={setQuery}
            scope={scope}
            onScopeChange={changeScope}
            onOpen={onFileSelect}
            focusRequest={searchFocusRequest}
            onFocusHandled={onSearchFocusHandled}
          />
        )}
        {/* Hidden, not unmounted, while search results stand in for it: the
          folders the user had open stay open. */}
        <div className="tree-main" hidden={searching}>
          <div className="tree-toolbar">
            {/* The way up is the parent folder, by name: one click goes
              there. An arrow alone read as "collapse" or "scroll up". */}
            {parent && (
              <>
                <Tooltip text={t.treeParentFolder}>
                  <button
                    type="button"
                    className="tree-crumb"
                    onClick={() => onRootChange(parent)}
                    aria-label={`${t.treeParentFolder}: ${basename(parent.replace(/[\\/]+$/, "")) || parent}`}
                  >
                    <ChevronIcon className="tree-crumb-back" />
                    <span className="tree-crumb-name">
                      {basename(parent.replace(/[\\/]+$/, "")) || parent}
                    </span>
                  </button>
                </Tooltip>
                <span className="tree-crumb-sep" aria-hidden="true">
                  /
                </span>
              </>
            )}
            <span className="tree-root-label" title={root}>
              {basename(root.replace(/[\\/]+$/, "")) || root}
            </span>
            {!isIOSApp && (
              <Tooltip text={t.treeSort}>
                <button
                  type="button"
                  className="tree-tool"
                  aria-label={t.treeSort}
                  aria-haspopup="menu"
                  onClick={openSortMenu}
                >
                  <SortIcon />
                </button>
              </Tooltip>
            )}
            {onOpenFolder && (
              <Tooltip text={t.menuOpenFolder}>
                <button
                  type="button"
                  className="tree-tool"
                  onClick={onOpenFolder}
                  aria-label={t.menuOpenFolder}
                >
                  <OpenFolderIcon />
                </button>
              </Tooltip>
            )}
            {folder && (
              <Tooltip text={t.menuCloseFolder}>
                <button
                  type="button"
                  className="tree-tool"
                  onClick={onCloseFolder}
                  aria-label={t.menuCloseFolder}
                >
                  <CloseIcon />
                </button>
              </Tooltip>
            )}
            <Tooltip text={t.treeRefresh}>
              <button
                type="button"
                className="tree-tool"
                onClick={() => setGeneration((g) => g + 1)}
                aria-label={t.treeRefresh}
              >
                <RefreshIcon />
              </button>
            </Tooltip>
          </div>
          <div
            ref={treeRef}
            role="tree"
            aria-label={t.treeTab}
            className={`tree-body${drag?.into === root ? " tree-body-drop" : ""}`}
            data-drop-dir={root}
            onKeyDown={treeKeys}
            onContextMenu={
              desktop ? (e) => onRowMenu(e, root, true) : undefined
            }
          >
            <DirNode
              key={`${root}\n${generation}`}
              path={root}
              depth={0}
              activePath={activePath}
              onFileSelect={onFileSelect}
              onEnter={onRootChange}
            />
          </div>
        </div>
        <Presence show={menu !== null} exitMs={120}>
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={menu.items}
              onClose={() => setMenu(null)}
            />
          )}
        </Presence>
        {drag &&
          createPortal(
            <div
              className="tree-drag-ghost floating-surface"
              style={{ left: drag.x + 12, top: drag.y + 8 }}
            >
              {drag.name}
            </div>,
            document.body,
          )}
      </div>
    </TreeContext.Provider>
  );
}

interface DirNodeProps {
  path: string;
  depth: number;
  activePath: string | null;
  onFileSelect: (path: string) => void;
  /** Re-roots the tree at a folder (double-click on its row). */
  onEnter: (path: string) => void;
}

/** Newest first; one the system gave no date for goes last. */
function byModified(a: DirEntryInfo, b: DirEntryInfo): number {
  return (b.modified_ms ?? -Infinity) - (a.modified_ms ?? -Infinity);
}

function DirNode({
  path,
  depth,
  activePath,
  onFileSelect,
  onEnter,
}: DirNodeProps) {
  const tree = useTree();
  const version = tree.versions[path] ?? 0;
  // The root is always open; a folder on the way down to the open document
  // starts open too, so walking "up" still shows where that document is.
  const [open, setOpen] = useState(
    depth === 0 || (activePath !== null && isInside(activePath, path)),
  );
  const [loaded, setLoaded] = useState<{
    version: number;
    entries: DirEntryInfo[];
  } | null>(null);
  // A document opened further down (from the search, say) shows where it
  // is: its folders open, the rest stay as the user left them.
  useEffect(() => {
    if (activePath !== null && isInside(activePath, path)) setOpen(true);
  }, [activePath, path]);
  // Something was made in it or moved into it: show it.
  useEffect(() => {
    if (version > 0) setOpen(true);
  }, [version]);

  useEffect(() => {
    if (!open || loaded?.version === version) return;
    let cancelled = false;
    fs.listDir(path).then(
      (entries) => !cancelled && setLoaded({ version, entries }),
      // Unreadable (permissions, vanished): show it empty rather than retry.
      () => !cancelled && setLoaded({ version, entries: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [open, loaded, version, path]);
  // In the file manager's order for the UI's language (utils/name-order),
  // not the backend's byte order: "第2章" before "第10章". Folders first
  // either way; "Documents only" leaves out the other files.
  const { settings } = useSettings();
  const collator = nameCollator(localeOf(settings.language));
  const sorted = useMemo(() => {
    if (!loaded) return null;
    const shown = loaded.entries.filter(
      (entry) =>
        entry.is_dir || tree.scope === "all" || isDocumentName(entry.name),
    );
    return shown.sort(
      (a, b) =>
        (tree.sort === "modified" && a.is_dir === b.is_dir
          ? byModified(a, b)
          : 0) || compareEntries(collator, a, b),
    );
  }, [loaded, collator, tree.scope, tree.sort]);

  return (
    <div className="dir-node">
      {depth > 0 && (
        <div
          className={`tree-row${tree.dropInto === path ? " tree-row-drop" : ""}`}
          role="treeitem"
          aria-level={depth}
          aria-expanded={open}
          data-drop-dir={path}
          style={{ paddingLeft: depth * 14 }}
          onClick={() => {
            if (!tree.takeDragClick()) setOpen(!open);
          }}
          onDoubleClick={() => onEnter(path)}
          onContextMenu={
            tree.onRowMenu ? (e) => tree.onRowMenu!(e, path, true) : undefined
          }
          onPointerDown={
            tree.onRowPointerDown
              ? (e) => tree.onRowPointerDown!(e, path, basename(path), true)
              : undefined
          }
        >
          <ChevronIcon className={`chevron ${open ? "chevron-open" : ""}`} />
          {open ? (
            <FolderOpenIcon className="tree-icon" />
          ) : (
            <FolderIcon className="tree-icon" />
          )}
          <span className="tree-label">{basename(path)}</span>
        </div>
      )}
      {open && sorted && (
        <div className="dir-children" role={depth > 0 ? "group" : "none"}>
          {sorted.map((entry) =>
            entry.is_dir ? (
              <DirNode
                key={entry.path}
                path={entry.path}
                depth={depth + 1}
                activePath={activePath}
                onFileSelect={onFileSelect}
                onEnter={onEnter}
              />
            ) : (
              <FileNode
                key={entry.path}
                entry={entry}
                depth={depth + 1}
                active={entry.path === activePath}
                onSelect={onFileSelect}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function FileNode({
  entry,
  depth,
  active,
  onSelect,
}: {
  entry: DirEntryInfo;
  depth: number;
  active: boolean;
  onSelect: (path: string) => void;
}) {
  const { t } = useSettings();
  const tree = useTree();
  const Icon = fileIconFor(entry.name);
  const press = useLongPress();
  return (
    <>
      <div
        className={`tree-row ${active ? "tree-row-active" : ""}`}
        role="treeitem"
        aria-level={depth}
        aria-selected={active}
        // Dropped on a file, a drag goes into that file's folder.
        data-drop-dir={parentDir(entry.path) ?? undefined}
        style={{ paddingLeft: depth * 14 + 12 }}
        onClick={() => {
          if (tree.takeDragClick()) return;
          if (!press.consumeClick()) onSelect(entry.path);
        }}
        onContextMenu={
          tree.onRowMenu
            ? (e) => tree.onRowMenu!(e, entry.path, false)
            : undefined
        }
        onPointerDown={
          tree.onRowPointerDown
            ? (e) => tree.onRowPointerDown!(e, entry.path, entry.name, false)
            : undefined
        }
        {...(isIOSApp ? press.handlers : {})}
      >
        <Icon className="tree-icon" />
        <span className="tree-label">{entry.name}</span>
      </div>
      <Presence show={!!press.at} exitMs={250}>
        {press.at && (
          <ContextMenu
            x={press.at.x}
            y={press.at.y}
            title={entry.name}
            onClose={press.close}
            items={[
              { label: t.treeOpen, onSelect: () => onSelect(entry.path) },
              {
                label: t.menuShare,
                onSelect: () => void iosFiles.share(entry.path).catch(() => {}),
              },
            ]}
          />
        )}
      </Presence>
    </>
  );
}
