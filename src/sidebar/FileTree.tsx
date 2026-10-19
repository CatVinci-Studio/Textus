import { useEffect, useState } from "react";
import type { DirEntryInfo } from "../platform/fs-types";
import {
  ArrowUpIcon,
  ChevronIcon,
  CloseIcon,
  FolderIcon,
  FolderOpenIcon,
  RefreshIcon,
  fileIconFor,
  isImageName,
} from "../ui/icons";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImageViewer } from "./ImageViewer";
import { fs } from "../platform/ipc";
import { useSettings } from "../settings/SettingsContext";
import { basename, isInside, parentDir } from "../utils/path";
import { isIOSApp } from "../platform/capabilities";
import { iosFiles } from "../platform/ios-files";
import { ContextMenu } from "../editor/ContextMenu";
import { Presence } from "../ui/usePresence";
import { useLongPress } from "../utils/hooks/useLongPress";
import "./FileTree.css";

interface FileTreeProps {
  /** The active document's folder: where the tree starts. The caller keys
   *  the tree on it, so switching to a document elsewhere starts over. */
  rootPath: string;
  /** The tree is a folder the user opened (not the document's own). */
  opened?: boolean;
  onOpenFolder?: () => void;
  onCloseFolder?: () => void;
  activePath: string | null;
  onFileSelect: (path: string) => void;
}

export function FileTree({
  rootPath,
  opened = false,
  onOpenFolder,
  onCloseFolder,
  activePath,
  onFileSelect,
}: FileTreeProps) {
  const { t, settings } = useSettings();
  const zh = settings.language.startsWith("zh");
  // Where the tree is rooted right now; "up" walks it toward the filesystem
  // root without touching the open document.
  const [root, setRoot] = useState(rootPath);
  // Bumped by Refresh: remounts every node so each re-reads its folder.
  const [generation, setGeneration] = useState(0);
  // A picture opened from the tree: shown on its own (ImageViewer), with
  // the other pictures of its folder a key away.
  const [viewer, setViewer] = useState<{
    paths: string[];
    start: number;
  } | null>(null);
  // Not on iOS: above Documents is the app's private container, and above
  // a folder picked in Files is outside what the user granted.
  const parent = isIOSApp ? null : parentDir(root);

  return (
    <div className="file-tree">
      <div className="tree-toolbar">
        {!isIOSApp && (
          <button
            className="tree-tool"
            onClick={() => parent && setRoot(parent)}
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
        <button
          className="tree-tool"
          onClick={() => setGeneration((g) => g + 1)}
          title={t.treeRefresh}
          aria-label={t.treeRefresh}
        >
          <RefreshIcon />
        </button>
        {!isIOSApp && onOpenFolder && (
          <button
            className="tree-tool"
            onClick={onOpenFolder}
            title={zh ? "打开文件夹" : "Open folder"}
            aria-label={zh ? "打开文件夹" : "Open folder"}
          >
            <FolderOpenIcon />
          </button>
        )}
        {opened && onCloseFolder && (
          <button
            className="tree-tool"
            onClick={onCloseFolder}
            title={
              zh
                ? "关闭文件夹，跟随当前文档"
                : "Close folder - follow the document"
            }
            aria-label={zh ? "关闭文件夹" : "Close folder"}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      <DirNode
        key={`${root}\n${generation}`}
        path={root}
        depth={0}
        activePath={activePath}
        onFileSelect={onFileSelect}
        onPreview={(paths, start) => setViewer({ paths, start })}
        onEnter={setRoot}
      />
      {viewer && (
        <ImageViewer
          paths={viewer.paths}
          start={viewer.start}
          docPath={activePath}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

interface DirNodeProps {
  path: string;
  depth: number;
  activePath: string | null;
  onFileSelect: (path: string) => void;
  /** A picture clicked: its folder's pictures and which one. */
  onPreview: (paths: string[], start: number) => void;
  /** Re-roots the tree at a folder (double-click on its row). */
  onEnter: (path: string) => void;
}

function DirNode({
  path,
  depth,
  activePath,
  onFileSelect,
  onPreview,
  onEnter,
}: DirNodeProps) {
  // The root is always open; a folder on the way down to the open document
  // starts open too, so walking "up" still shows where that document is.
  const [open, setOpen] = useState(
    depth === 0 || (activePath !== null && isInside(activePath, path)),
  );
  const [children, setChildren] = useState<DirEntryInfo[] | null>(null);

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
      {open && children && (
        <div className="dir-children">
          {children.map((entry, _, all) =>
            entry.is_dir ? (
              <DirNode
                key={entry.path}
                path={entry.path}
                depth={depth + 1}
                activePath={activePath}
                onFileSelect={onFileSelect}
                onPreview={onPreview}
                onEnter={onEnter}
              />
            ) : (
              <FileNode
                key={entry.path}
                entry={entry}
                depth={depth + 1}
                active={entry.path === activePath}
                onSelect={
                  isImageName(entry.name)
                    ? () => {
                        const pictures = all
                          .filter((e) => !e.is_dir && isImageName(e.name))
                          .map((e) => e.path);
                        onPreview(pictures, pictures.indexOf(entry.path));
                      }
                    : onFileSelect
                }
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
  const [thumbFailed, setThumbFailed] = useState(false);
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
        {isImageName(entry.name) && !thumbFailed ? (
          <img
            className="tree-thumb"
            src={convertFileSrc(entry.path)}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <Icon className="tree-icon" />
        )}
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
