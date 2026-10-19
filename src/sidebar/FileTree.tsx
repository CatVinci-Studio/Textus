import { useEffect, useMemo, useState } from "react";
import type { DirEntryInfo } from "../platform/fs-types";
import {
  ArrowUpIcon,
  ChevronIcon,
  CloseIcon,
  FolderIcon,
  FolderOpenIcon,
  OpenFolderIcon,
  RefreshIcon,
  fileIconFor,
} from "../ui/icons";
import { fs } from "../platform/ipc";
import { useSettings } from "../settings/SettingsContext";
import { basename, isInside, parentDir } from "../utils/path";
import { canOpenFolder, isIOSApp } from "../platform/capabilities";
import { iosFiles } from "../platform/ios-files";
import { ContextMenu } from "../editor/ContextMenu";
import { Presence } from "../ui/usePresence";
import { useLongPress } from "../utils/hooks/useLongPress";
import { FileSearch } from "./FileSearch";
import { localeOf } from "../i18n/langs";
import { compareEntries, nameCollator } from "../utils/name-order";
import "./FileTree.css";

interface FileTreeProps {
  /** Where the tree is rooted (app/useOpenFolder.ts decides when the
   *  document in front moves it); "up" and double-clicking a folder move it
   *  through `onRootChange` without touching the open document. */
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
  onOpenFolder,
  onCloseFolder,
  searchFocusRequest,
  onSearchFocusHandled,
}: FileTreeProps) {
  const { t } = useSettings();
  // Bumped by Refresh: remounts every node so each re-reads its folder, and
  // the search indexes the folder again.
  const [generation, setGeneration] = useState(0);
  const [query, setQuery] = useState("");
  // Not on iOS: above Documents is the app's private container, and above
  // a folder picked in Files is outside what the user granted. Not above an
  // opened folder either: that is the edge of what the user opened.
  const parent = isIOSApp || root === folder ? null : parentDir(root);
  const searching = query.trim() !== "";

  return (
    <div className="file-tree">
      {/* Not on iOS (see canOpenFolder): its folders can be Files-app
        URLs, which the backend can't walk. */}
      {canOpenFolder && (
        <FileSearch
          root={folder ?? root}
          refreshKey={generation}
          query={query}
          onQueryChange={setQuery}
          onOpen={onFileSelect}
          focusRequest={searchFocusRequest}
          onFocusHandled={onSearchFocusHandled}
        />
      )}
      {/* Hidden, not unmounted, while search results stand in for it: the
        folders the user had open stay open. */}
      <div className="tree-main" hidden={searching}>
        <div className="tree-toolbar">
          {!isIOSApp && (
            <button
              className="tree-tool"
              onClick={() => parent && onRootChange(parent)}
              disabled={!parent}
              title={t.treeParentFolder}
              aria-label={t.treeParentFolder}
            >
              <ArrowUpIcon />
            </button>
          )}
          <span className="tree-root-label" title={root}>
            {basename(root.replace(/[\\/]+$/, "")) || root}
          </span>
          {onOpenFolder && (
            <button
              className="tree-tool"
              onClick={onOpenFolder}
              title={t.menuOpenFolder}
              aria-label={t.menuOpenFolder}
            >
              <OpenFolderIcon />
            </button>
          )}
          {folder && (
            <button
              className="tree-tool"
              onClick={onCloseFolder}
              title={t.menuCloseFolder}
              aria-label={t.menuCloseFolder}
            >
              <CloseIcon />
            </button>
          )}
          <button
            className="tree-tool"
            onClick={() => setGeneration((g) => g + 1)}
            title={t.treeRefresh}
            aria-label={t.treeRefresh}
          >
            <RefreshIcon />
          </button>
        </div>
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

function DirNode({
  path,
  depth,
  activePath,
  onFileSelect,
  onEnter,
}: DirNodeProps) {
  // The root is always open; a folder on the way down to the open document
  // starts open too, so walking "up" still shows where that document is.
  const [open, setOpen] = useState(
    depth === 0 || (activePath !== null && isInside(activePath, path)),
  );
  const [children, setChildren] = useState<DirEntryInfo[] | null>(null);
  // A document opened further down (from the search, say) shows where it
  // is: its folders open, the rest stay as the user left them.
  useEffect(() => {
    if (activePath !== null && isInside(activePath, path)) setOpen(true);
  }, [activePath, path]);

  useEffect(() => {
    if (!open || children !== null) return;
    let cancelled = false;
    fs.listDir(path).then(
      (entries) => !cancelled && setChildren(entries),
      // Unreadable (permissions, vanished): show it empty rather than retry.
      () => !cancelled && setChildren([]),
    );
    return () => {
      cancelled = true;
    };
  }, [open, children, path]);
  // In the file manager's order for the UI's language (utils/name-order),
  // not the backend's byte order: "第2章" before "第10章".
  const { settings } = useSettings();
  const collator = nameCollator(localeOf(settings.language));
  const sorted = useMemo(
    () =>
      children && [...children].sort((a, b) => compareEntries(collator, a, b)),
    [children, collator],
  );

  return (
    <div className="dir-node">
      {depth > 0 && (
        <button
          className="tree-row"
          style={{ paddingLeft: depth * 14 }}
          onClick={() => setOpen(!open)}
          onDoubleClick={() => onEnter(path)}
        >
          <ChevronIcon className={`chevron ${open ? "chevron-open" : ""}`} />
          {open ? (
            <FolderOpenIcon className="tree-icon" />
          ) : (
            <FolderIcon className="tree-icon" />
          )}
          <span className="tree-label">{basename(path)}</span>
        </button>
      )}
      {open && sorted && (
        <div className="dir-children">
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
  const Icon = fileIconFor(entry.name);
  const press = useLongPress();
  return (
    <>
      <button
        className={`tree-row ${active ? "tree-row-active" : ""}`}
        style={{ paddingLeft: depth * 14 + 12 }}
        onClick={() => {
          if (!press.consumeClick()) onSelect(entry.path);
        }}
        {...(isIOSApp ? press.handlers : {})}
      >
        <Icon className="tree-icon" />
        <span className="tree-label">{entry.name}</span>
      </button>
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
