// The file tree's rows: a folder, which reads and lists its entries, and
// a file. Inside a FileTree, whose context they read (tree-shared.ts).

import { useEffect, useMemo, useState } from "react";
import type { DirEntryInfo } from "../platform/fs-types";
import {
  ChevronIcon,
  FolderIcon,
  FolderOpenIcon,
  fileIconFor,
} from "../ui/icons";
import { fs } from "../platform/ipc";
import { useSettings } from "../settings/SettingsContext";
import { basename, isInside, parentDir } from "../utils/path";
import { isIOSApp } from "../platform/capabilities";
import { iosFiles } from "../platform/ios-files";
import { ContextMenu } from "../editor/ContextMenu";
import { Presence } from "../ui/usePresence";
import { useLongPress } from "../utils/hooks/useLongPress";
import { isDocumentName } from "./file-search";
import { localeOf } from "../i18n/langs";
import { compareEntries, nameCollator } from "../utils/name-order";
import { useTree } from "./tree-shared";

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

export function DirNode({
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
