import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronIcon,
  CloseIcon,
  OpenFolderIcon,
  RefreshIcon,
  SortIcon,
} from "../ui/icons";
import { fs, windowIpc } from "../platform/ipc";

const openInNewWindow = (path: string) =>
  void windowIpc.openPathInNewWindow(path);
import { useSettings } from "../settings/SettingsContext";
import { basename, parentDir } from "../utils/path";
import { canOpenFolder, isIOSApp } from "../platform/capabilities";
import { ContextMenu, type ContextMenuItem } from "../editor/ContextMenu";
import { contributedContextItems } from "../ui/context-menu-items";
import { Presence } from "../ui/usePresence";
import { useTreeKeys } from "../ui/useTreeKeys";
import { FileSearch } from "./FileSearch";
import { type SearchScope } from "./file-search";
import { Tooltip } from "../ui/Tooltip";
import { getUiState, setUiState } from "../storage/ui-state";
import { showConfirm, showMessage, showPrompt } from "../ui/app-dialog";
import type { Strings } from "../i18n/strings";
import {
  failureText,
  TreeContext,
  type TreeShared,
  type TreeSort,
} from "./tree-shared";
import { useRowDrag } from "./useRowDrag";
import { DirNode } from "./TreeNodes";
import "./FileTree.css";
export type { TreeSort } from "./tree-shared";

interface FileTreeProps {
  /** Where the tree is rooted; the toolbar's parent folder and double-clicking
   *  a folder move it through `onRootChange` without touching the open document. */
  root: string;
  onRootChange: (path: string) => void;
  /** The folder opened with File > Open Folder…, or null. The tree stays
   *  inside it, and the search covers all of it. */
  folder: string | null;
  activePath: string | null;
  /** `beside`: Open to the Side, in a split beside the one in front. */
  onFileSelect: (path: string, beside?: boolean) => void;
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
  const view = useTreeView();
  const { generation, setGeneration, query, setQuery } = view;
  const { sort, setSort, scope, setScope, versions, reload } = view;
  const { showHidden, setShowHidden } = view;
  const [menu, setMenu] = useState<TreeMenu>(null);
  // Not on iOS: above Documents is the app's private container, and above
  // a folder picked in Files is outside what the user granted. Not above an
  // opened folder either: that is the edge of what the user opened.
  const parent = isIOSApp || root === folder ? null : parentDir(root);
  const searching = query.trim() !== "";
  const treeRef = useRef<HTMLDivElement>(null);
  const treeKeys = useTreeKeys(treeRef);
  const desktop = !isIOSApp && canOpenFolder;

  const onRowMenu = useRowMenu(
    root,
    t,
    reload,
    onFileSelect,
    onEntryMoved,
    setMenu,
  );
  const { drag, onRowPointerDown, takeDragClick } = useRowDrag(
    treeRef,
    reload,
    onEntryMoved,
    t,
  );
  const shared = useMemo<TreeShared>(
    () => ({
      sort,
      scope,
      showHidden,
      versions,
      dropInto: drag?.into ?? null,
      onRowMenu: desktop ? onRowMenu : null,
      onRowPointerDown: desktop ? onRowPointerDown : null,
      openInNewWindow: desktop ? openInNewWindow : null,
      takeDragClick,
    }),
    [
      sort,
      scope,
      showHidden,
      versions,
      drag?.into,
      desktop,
      onRowMenu,
      onRowPointerDown,
      takeDragClick,
    ],
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
        "separator",
        {
          label: t.treeShowHidden,
          checked: showHidden,
          onSelect: () => {
            setShowHidden(!showHidden);
            setUiState("fileTreeHidden", showHidden ? "0" : "1");
          },
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
        {/* Not on iOS: its folders can be Files-app URLs, which the
          backend can't walk. */}
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
            {/* The way up is the parent folder, by name: an arrow alone read
              as "collapse" or "scroll up". */}
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

/** What the tree shows: its sort, the search's query and scope, and
 *  `generation`, bumped by Refresh to remount every node and re-index.
 *  `reload` re-reads only the folders named. */
function useTreeView() {
  const [generation, setGeneration] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TreeSort>(savedSort);
  const [scope, setScope] = useState<SearchScope>(savedScope);
  const [showHidden, setShowHidden] = useState(
    () => getUiState("fileTreeHidden") === "1",
  );
  const [versions, setVersions] = useState<Record<string, number>>({});
  const reload = useCallback((...dirs: string[]) => {
    setVersions((prev) => {
      const next = { ...prev };
      for (const dir of dirs) next[dir] = (next[dir] ?? 0) + 1;
      return next;
    });
  }, []);
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
  };
}

type TreeMenu = {
  x: number;
  y: number;
  items: (ContextMenuItem | "separator")[];
} | null;

/** A row's context menu: open, new document or folder, rename, move to Trash. */
function useRowMenu(
  root: string,
  t: Strings,
  reload: (...dirs: string[]) => void,
  onFileSelect: (path: string, beside?: boolean) => void,
  onEntryMoved: (from: string, to: string) => void,
  setMenu: (menu: TreeMenu) => void,
) {
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
      } catch (err) {
        await showMessage(failureText(t, err, name.trim()));
      }
    },
    [root, t, reload, onEntryMoved],
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

  return useCallback(
    (e: ReactMouseEvent, path: string, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      // New things go into the folder clicked, or the one the file is in.
      const dir = isDir ? path : (parentDir(path) ?? root);
      const items: (ContextMenuItem | "separator")[] = [];
      if (path !== root && !isDir)
        items.push(
          { label: t.treeOpen, onSelect: () => onFileSelect(path) },
          // Not on a phone: one document fills its screen.
          ...(isIOSApp
            ? []
            : [
                {
                  label: t.openBeside,
                  onSelect: () => onFileSelect(path, true),
                },
              ]),
          "separator",
        );
      items.push(
        {
          label: t.treeNewDocument,
          onSelect: () => void create(dir, "document"),
        },
        { label: t.treeNewFolder, onSelect: () => void create(dir, "folder") },
      );
      if (path !== root)
        items.push(
          "separator",
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
    [root, t, create, rename, trash, onFileSelect, setMenu],
  );
}
