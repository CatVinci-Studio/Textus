import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  ChevronIcon,
  CloseIcon,
  NewDocumentIcon,
  NewFolderIcon,
  ProjectIcon,
  RefreshIcon,
  SortIcon,
} from "../engine/controls/icons";
import { windowIpc } from "../platform/ipc";

const openInNewWindow = (path: string) =>
  void windowIpc.openPathInNewWindow(path);
import { useSettings } from "../prefs/SettingsContext";
import { basename, parentDir } from "../utils/path";
import { canOpenFolder, isIOSApp } from "../platform/capabilities";
import { ContextMenu } from "../engine/controls/ContextMenu";
import { Presence } from "../engine/motion/usePresence";
import { useTreeKeys } from "../engine/controls/useTreeKeys";
import { FileSearch } from "./FileSearch";
import { type SearchScope } from "./file-search";
import { Tooltip } from "../engine/controls/Tooltip";
import { setUiState } from "../storage/ui-state";
import { TreeContext, type TreeShared, type TreeSort } from "./tree-shared";
import { useRowDrag } from "./useRowDrag";
import { DirNode } from "./TreeNodes";
import "./FileTree.css";
import { isWithin } from "./tree-root";
import type { FileOpenHow } from "./tree-shared";
import { useTreeView } from "./useTreeData";
import { useRowMenu } from "./useRowMenu";
import { useNewEntry } from "./useNewEntry";
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
  /** How it opens: a tab of its own unless `how` says to look (a click,
   *  the preview tab) or Open to the Side. */
  onFileSelect: (path: string, how?: FileOpenHow) => void;
  /** Opens the folder the tree shows as the window's folder; desktop only. */
  onOpenAsFolder?: (path: string) => void;
  /** File > Close Folder. */
  onCloseFolder: () => void;
  /** A file or folder was dragged into another folder: open tabs follow
   *  it to its new path. */
  onEntryMoved: (from: string, to: string) => void;
  /** The search shortcut asked for the search box. */
  searchFocusRequest: boolean;
  onSearchFocusHandled: () => void;
}

export function FileTree({
  root,
  onRootChange,
  folder,
  activePath,
  onFileSelect,
  onOpenAsFolder,
  onCloseFolder,
  onEntryMoved,
  searchFocusRequest,
  onSearchFocusHandled,
}: FileTreeProps) {
  const { t } = useSettings();
  const view = useTreeView(folder ?? root);
  const { generation, setGeneration, query, setQuery } = view;
  const { sort, setSort, scope, setScope, versions, reload } = view;
  const { showHidden, setShowHidden } = view;
  // Not on iOS: above Documents is the app's private container, and above
  // a folder picked in Files is outside what the user granted. Not above an
  // opened folder either: that is the edge of what the user opened.
  const parent = isIOSApp || root === folder ? null : parentDir(root);
  const searching = query.trim() !== "";
  const treeRef = useRef<HTMLDivElement>(null);
  const treeKeys = useTreeKeys(treeRef);
  const desktop = !isIOSApp && canOpenFolder;
  const { draft, setDraft, finishDraft } = useNewEntry(t, reload, onFileSelect);

  const { menu, setMenu, onRowMenu } = useRowMenu(
    root,
    folder ?? root,
    t,
    reload,
    onFileSelect,
    onEntryMoved,
    setDraft,
    onRootChange,
  );
  const { drag, onRowPointerDown, takeDragClick } = useRowDrag(
    treeRef,
    reload,
    onEntryMoved,
    folder ?? root,
    t,
  );
  const shared = useMemo<TreeShared>(
    () => ({
      sort,
      scope,
      showHidden,
      versions,
      stale: view.stale,
      refreshed: view.refreshed,
      dropInto: drag?.into ?? null,
      onRowMenu: desktop ? onRowMenu : null,
      onRowPointerDown: desktop ? onRowPointerDown : null,
      openInNewWindow: desktop ? openInNewWindow : null,
      takeDragClick,
      draft,
      finishDraft,
      newDocument: desktop
        ? {
            label: t.treeNewDocument,
            start: () => setDraft({ dir: root, kind: "document" }),
          }
        : null,
    }),
    [
      sort,
      scope,
      showHidden,
      versions,
      view.stale,
      view.refreshed,
      drag?.into,
      desktop,
      onRowMenu,
      onRowPointerDown,
      takeDragClick,
      draft,
      finishDraft,
      setDraft,
      root,
      t,
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
            {desktop && (
              <>
                <Tooltip text={t.treeNewDocument}>
                  <button
                    type="button"
                    className="tree-tool"
                    aria-label={t.treeNewDocument}
                    onClick={() => setDraft({ dir: root, kind: "document" })}
                  >
                    <NewDocumentIcon />
                  </button>
                </Tooltip>
                <Tooltip text={t.treeNewFolder}>
                  <button
                    type="button"
                    className="tree-tool"
                    aria-label={t.treeNewFolder}
                    onClick={() => setDraft({ dir: root, kind: "folder" })}
                  >
                    <NewFolderIcon />
                  </button>
                </Tooltip>
              </>
            )}
            {/* The tree following the document's folder: one button opens
                it as the folder, its tip saying whose folder it is. */}
            {!folder && onOpenAsFolder && (
              <Tooltip
                text={t.treeOpenAsFolder}
                description={
                  activePath && isWithin(activePath, root)
                    ? t.treeDocumentFolder
                    : null
                }
              >
                <button
                  type="button"
                  className="tree-tool"
                  aria-label={t.treeOpenAsFolder}
                  onClick={() => onOpenAsFolder(root)}
                >
                  <ProjectIcon />
                </button>
              </Tooltip>
            )}
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
            // Double-click on the blank below the rows: a new document there.
            onDoubleClick={
              desktop
                ? (e) => {
                    if (!(e.target as HTMLElement).closest(".tree-row"))
                      setDraft({ dir: root, kind: "document" });
                  }
                : undefined
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
      </div>
    </TreeContext.Provider>
  );
}
