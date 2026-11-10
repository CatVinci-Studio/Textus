// The file tree's rows: a folder, which reads and lists its entries, and
// a file.

import { useChangedFiles } from "../ai/chat/file-changes";
import { useEffect, useMemo, useState } from "react";
import type { DirEntryInfo } from "../platform/fs-types";
import {
  ChevronIcon,
  FolderIcon,
  FolderOpenIcon,
} from "../engine/controls/icons";
import { fs } from "../platform/ipc";
import { useSettings } from "../prefs/SettingsContext";
import { basename, isInside, parentDir } from "../utils/path";
import { isIOSApp } from "../platform/capabilities";
import { iosFiles } from "../platform/ios-files";
import { ContextMenu } from "../engine/controls/ContextMenu";
import { Presence } from "../engine/motion/usePresence";
import { useLongPress } from "../utils/hooks/useLongPress";
import { isDocumentName } from "./file-search";
import { localeOf } from "../i18n/langs";
import { compareEntries, nameCollator } from "../utils/name-order";
import { useTree } from "./tree-shared";
import { DraftRow } from "./DraftRow";
import type { FileOpenHow } from "./tree-shared";
import { fileIconFor } from "../engine/controls/file-icons";

interface DirNodeProps {
  path: string;
  depth: number;
  /** Left out by a .gitignore: shown dimmed, as the search leaves it out. */
  ignored?: boolean;
  activePath: string | null;
  onFileSelect: (path: string, how?: FileOpenHow) => void;
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
  ignored = false,
  activePath,
  onFileSelect,
  onEnter,
}: DirNodeProps) {
  const tree = useTree();
  const version = tree.versions[path] ?? 0;
  const listing = `${version}:${tree.stale[path] ?? 0}:${tree.refreshed}`;
  // The root is always open, and so is a folder on the way down to the open
  // document.
  const [open, setOpen] = useState(
    depth === 0 || (activePath !== null && isInside(activePath, path)),
  );
  const [loaded, setLoaded] = useState<{
    listing: string;
    entries: DirEntryInfo[];
  } | null>(null);
  // A document opened further down shows where it is: its folders open, the
  // rest stay as they were.
  useEffect(() => {
    if (activePath !== null && isInside(activePath, path)) setOpen(true);
  }, [activePath, path]);
  // Something was made in it or moved into it, or is being named in it:
  // show it.
  const drafting = tree.draft?.dir === path ? tree.draft.kind : null;
  useEffect(() => {
    if (version > 0 || drafting) setOpen(true);
  }, [version, drafting]);

  useEffect(() => {
    if (!open || loaded?.listing === listing) return;
    let cancelled = false;
    fs.listDir(path).then(
      (entries) => !cancelled && setLoaded({ listing, entries }),
      // Unreadable (permissions, vanished): show it empty rather than retry.
      () => !cancelled && setLoaded({ listing, entries: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [open, loaded, listing, path]);
  // In the file manager's order for the UI language, not byte order
  // ("第2章" before "第10章"). Folders first.
  const { settings } = useSettings();
  const collator = nameCollator(localeOf(settings.language));
  const sorted = useMemo(() => {
    if (!loaded) return null;
    const shown = loaded.entries.filter(
      (entry) =>
        (tree.showHidden || !entry.hidden) &&
        (entry.is_dir || tree.scope === "all" || isDocumentName(entry.name)),
    );
    return shown.sort(
      (a, b) =>
        (tree.sort === "modified" && a.is_dir === b.is_dir
          ? byModified(a, b)
          : 0) || compareEntries(collator, a, b),
    );
  }, [loaded, collator, tree.scope, tree.sort, tree.showHidden]);

  return (
    <div className="dir-node">
      {depth > 0 && (
        <div
          className={`tree-row${tree.dropInto === path ? " tree-row-drop" : ""}${ignored ? " tree-row-ignored" : ""}`}
          role="treeitem"
          aria-level={depth}
          aria-expanded={open}
          data-drop-dir={path}
          style={{ paddingLeft: depth * 14 }}
          // A double click folds or unfolds it once, as a click does; going
          // into it is the row's menu's Show Only This Folder.
          onClick={(e) => {
            if (e.detail > 1 || tree.takeDragClick()) return;
            setOpen(!open);
          }}
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
          {drafting && loaded && (
            <DraftRow
              kind={drafting}
              depth={depth + 1}
              entries={loaded.entries}
            />
          )}
          {depth === 0 &&
            sorted.length === 0 &&
            !drafting &&
            tree.newDocument && (
              // Empty: a button that makes the first document.
              <div className="tx-empty tree-empty">
                <button
                  type="button"
                  className="tx-button"
                  onClick={tree.newDocument.start}
                >
                  {tree.newDocument.label}
                </button>
              </div>
            )}
          {sorted.map((entry) =>
            entry.is_dir ? (
              <DirNode
                key={entry.path}
                path={entry.path}
                depth={depth + 1}
                ignored={entry.ignored}
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
  onSelect: (path: string, how?: FileOpenHow) => void;
}) {
  const { t } = useSettings();
  const tree = useTree();
  const Icon = fileIconFor(entry.name);
  const press = useLongPress();
  const changed = useChangedFiles().has(entry.path);
  return (
    <>
      <div
        className={`tree-row${active ? " tree-row-active" : ""}${entry.ignored ? " tree-row-ignored" : ""}`}
        role="treeitem"
        aria-level={depth}
        aria-selected={active}
        data-ai-changed={changed || undefined}
        // Dropped on a file, a drag goes into that file's folder.
        data-drop-dir={parentDir(entry.path) ?? undefined}
        style={{ paddingLeft: depth * 14 + 12 }}
        onClick={(e) => {
          if (tree.takeDragClick()) return;
          if ((e.metaKey || e.ctrlKey) && tree.openInNewWindow)
            return tree.openInNewWindow(entry.path);
          // A click looks (the preview tab); a double click keeps it.
          if (!press.consumeClick()) onSelect(entry.path, "preview");
        }}
        onDoubleClick={() => onSelect(entry.path)}
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
