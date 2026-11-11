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
  void windowIpc.openPathInNewWindow(path).catch(() => undefined);
import { useSettings } from "../prefs/SettingsContext";
import { basename, parentDir } from "../utils/path";
import { canOpenFolder, isIOSApp } from "../platform/capabilities";
import { ContextMenu } from "../engine/controls/ContextMenu";
import { Presence } from "../engine/motion/usePresence";
import { useTreeKeys } from "../engine/controls/useTreeKeys";
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
  // Not on iOS: above Documents is the app's private container, and above
  // a folder picked in Files is outside what the user granted. Not above an
  // opened folder either: that is the edge of what the user opened.
  const parent = isIOSApp || root === folder ? null : parentDir(root);
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
    folder ? null : onRootChange,
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
      reveal,
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
      reveal,
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
      ],
    });
  };

  return (
    <TreeContext.Provider value={shared}>
      <div className={`file-tree${drag ? " file-tree-dragging" : ""}`}>
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
            />
          </div>
        </div>
        <Presence show={menu !== null}>
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
