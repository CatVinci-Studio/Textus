import { useLatestCallback } from "../utils/hooks/useLatest";
import { type MouseEvent as ReactMouseEvent } from "react";
import {
  ChevronIcon,
  CloseIcon,
  NewDocumentIcon,
  NewFolderIcon,
  ProjectIcon,
  RefreshIcon,
  SortIcon,
} from "../engine/controls/icons";

import { useSettings } from "../prefs/SettingsContext";
import { fs } from "../platform/ipc";
import { isFarUrl } from "../platform/far-files";
import { folderName, parentDir } from "../utils/path";
import { canOpenFolder, isMobileApp } from "../platform/capabilities";
import { ContextMenu } from "../engine/controls/ContextMenu";
import { Presence } from "../engine/motion/usePresence";
import { Tooltip } from "../engine/controls/Tooltip";
import { setUiState } from "../storage/ui-state";
import {
  TreeContext,
  TreeRowActionsContext,
  type TreeSort,
} from "./tree-shared";
import { useTreeContexts } from "./useTreeContexts";
import { useTreeDrops } from "./useTreeDrops";
import { DirNode } from "./TreeNodes";
import "./FileTree.css";
import { isWithin } from "../utils/path";
import type { FileOpenHow } from "./tree-shared";
import { useTreeView } from "./useTreeData";
import { useRowMenu } from "./useRowMenu";
import { useNewEntry } from "./useNewEntry";
import { TreeSelectionContext, useTreeSelection } from "./tree-selection";

interface FileTreeProps {
  /** Where the tree is rooted. With no folder opened, the toolbar's parent
   *  folder and Show Only This Folder move it through `onRootChange`,
   *  without touching the open document; an opened folder stays whole. */
  root: string;
  onRootChange: (path: string) => void;
  /** A folder to bring into view (a plugin's showFolder). */
  reveal?: string | null;
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
}

export function FileTree({
  root,
  onRootChange,
  reveal = null,
  folder,
  activePath,
  onFileSelect,
  onOpenAsFolder,
  onCloseFolder,
  onEntryMoved,
}: FileTreeProps) {
  const { t } = useSettings();
  const view = useTreeView(folder ?? root);
  const { generation, setGeneration } = view;
  const { sort, setSort, scope, setScope, versions, reload } = view;
  const { showHidden, setShowHidden } = view;
  // Not on a phone: above Documents is the app's private container, and above
  // a picked folder is outside what the user granted. Not above an
  // opened folder either: that is the edge of what the user opened.
  const parent = isMobileApp || root === folder ? null : parentDir(root);
  // One handler for the tree's life: a row redraws only when it changes.
  const select = useLatestCallback(onFileSelect);
  const desktop = !isMobileApp && canOpenFolder;
  const { draft, setDraft, finishDraft } = useNewEntry(t, reload, select);
  const { treeRef, onTreeKey, selection, picking, onRowPick } =
    useTreeSelection(root, activePath);

  const { menu, setMenu, onRowMenu, openRowMenu } = useRowMenu(
    root,
    folder ?? root,
    t,
    reload,
    select,
    onEntryMoved,
    setDraft,
    folder ? null : onRootChange,
    selection,
    view.collapseAll,
  );
  const { drag, onRowPointerDown, into } = useTreeDrops({
    treeRef,
    folder,
    linkBase: folder ?? root,
    reload,
    onEntryMoved,
    t,
    selection,
    onHeld: openRowMenu,
  });
  const { rowActions, shared } = useTreeContexts({
    sort,
    scope,
    showHidden,
    versions,
    stale: view.stale,
    refreshed: view.refreshed,
    openFolders: view.openFolders,
    collapsed: view.collapsed,
    dropInto: into,
    desktop,
    onRowMenu,
    onRowPointerDown,
    onRowPick,
    draft,
    finishDraft,
    newDocumentLabel: t.menuNewFile,
    setDraft,
    root,
    reveal,
  });

  // The toolbar's New: in the folder last clicked, as the row's menu does;
  // at the root once that folder is gone (renamed, moved, trashed).
  const newEntry = async (kind: "document" | "folder") => {
    const dir = selection.newEntryDir(root, activePath);
    const there =
      dir === root ||
      isFarUrl(dir) ||
      (await fs.fileMtimeMs(dir).catch(() => null)) !== null;
    setDraft({ dir: there ? dir : root, kind });
  };

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
        // What the tree lists: every file, or documents and folders.
        ...(["all", "documents"] as const).map((next) => ({
          label:
            next === "all" ? t.treeSearchScopeAll : t.treeSearchScopeDocuments,
          checked: scope === next,
          onSelect: () => {
            setScope(next);
            setUiState("fileSearchScope", next);
          },
        })),
        "separator",
        {
          label: t.treeShowHidden,
          checked: showHidden,
          onSelect: () => {
            setShowHidden(!showHidden);
            setUiState("fileTreeHidden", showHidden ? "0" : "1");
          },
        },
        "separator",
        { label: t.treeCollapseAll, onSelect: view.collapseAll },
      ],
    });
  };

  return (
    <TreeContext.Provider value={shared}>
      <TreeRowActionsContext.Provider value={rowActions}>
        <TreeSelectionContext.Provider value={selection}>
          <div
            className={`file-tree${drag ? " file-tree-dragging" : ""}${picking ? " file-tree-picking" : ""}`}
          >
            <div className="tree-main">
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
                        aria-label={`${t.treeParentFolder}: ${folderName(parent)}`}
                      >
                        <ChevronIcon className="tree-crumb-back" />
                        <span className="tx-truncate tree-crumb-name">
                          {folderName(parent)}
                        </span>
                      </button>
                    </Tooltip>
                    <span className="tree-crumb-sep" aria-hidden="true">
                      /
                    </span>
                  </>
                )}
                <span className="tx-truncate tree-root-label" title={root}>
                  {folderName(root)}
                </span>
                {desktop && (
                  <>
                    <Tooltip text={t.menuNewFile}>
                      <button
                        type="button"
                        className="tx-icon-button tree-tool"
                        aria-label={t.menuNewFile}
                        onClick={() => void newEntry("document")}
                      >
                        <NewDocumentIcon />
                      </button>
                    </Tooltip>
                    <Tooltip text={t.treeNewFolder}>
                      <button
                        type="button"
                        className="tx-icon-button tree-tool"
                        aria-label={t.treeNewFolder}
                        onClick={() => void newEntry("folder")}
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
                      className="tx-icon-button tree-tool"
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
                    className="tx-icon-button tree-tool"
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
                      className="tx-icon-button tree-tool"
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
                    className="tx-icon-button tree-tool"
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
                className={`tree-body${into === root ? " tx-drop-into" : ""}`}
                data-drop-dir={root}
                onKeyDown={onTreeKey}
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
                  onFileSelect={select}
                />
              </div>
            </div>
            <Presence show={menu !== null}>
              {menu && (
                <ContextMenu
                  x={menu.x}
                  y={menu.y}
                  items={menu.items}
                  title={menu.title}
                  onClose={() => setMenu(null)}
                />
              )}
            </Presence>
          </div>
        </TreeSelectionContext.Provider>
      </TreeRowActionsContext.Provider>
    </TreeContext.Provider>
  );
}
