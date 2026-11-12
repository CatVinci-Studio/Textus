import { explainError } from "../utils/error-explain";
import { Tooltip } from "../engine/controls/Tooltip";
import { currentStrings } from "../i18n/current";
// The file tree's rows: a folder, which reads and lists its entries, and
// a file.

import { useFileMark } from "../registry/file-marks";
import { plural } from "../i18n/plural";
import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import { type DirEntryInfo } from "../platform/bindings/files";
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
import { isDocumentName } from "./document-name";
import { localeOf } from "../i18n/langs";
import { compareEntries, nameCollator } from "../utils/name-order";
import { useTree } from "./tree-shared";
import { isWithin } from "./tree-root";
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
}

/** Newest first; one the system gave no date for goes last. */
function byModified(a: DirEntryInfo, b: DirEntryInfo): number {
  return (b.modified_ms ?? -Infinity) - (a.modified_ms ?? -Infinity);
}

export const DirNode = memo(function DirNode({
  path,
  depth,
  ignored = false,
  activePath,
  onFileSelect,
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
    /** Why it couldn't be read, in the UI's language. */
    failed?: string;
  } | null>(null);
  // A document opened further down shows where it is, and so does a folder
  // asked to be shown (a plugin's showFolder): the folders on the way open,
  // the rest stay as they were.
  useEffect(() => {
    if (
      (activePath !== null && isInside(activePath, path)) ||
      (tree.reveal && isWithin(tree.reveal, path))
    )
      setOpen(true);
  }, [activePath, tree.reveal, path]);
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
      // Unreadable (permissions, vanished): said so, not shown empty with a
      // New Document that would fail too.
      (err: unknown) =>
        !cancelled &&
        setLoaded({
          listing,
          entries: [],
          failed: explainError(err, currentStrings()),
        }),
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
          style={{ "--depth": depth } as CSSProperties}
          // A double click folds or unfolds it once, as a click does; going
          // into it is the row's menu's Show Only This Folder.
          onClick={(e) => {
            if (e.detail > 1) return;
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
          <Tooltip text={basename(path)} description={null} whenCut>
            <span className="tx-truncate tree-label">{basename(path)}</span>
          </Tooltip>
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
          {loaded?.failed && (
            <div className="tx-list-note" role="status">
              {loaded?.failed}
            </div>
          )}
          {depth === 0 &&
            !loaded?.failed &&
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
});

/** A file's row; drawn again only when what it shows changed. */
const FileNode = memo(function FileNode({
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
  const { t, settings } = useSettings();
  const lang = settings.language;
  const tree = useTree();
  const Icon = fileIconFor(entry.name);
  const press = useLongPress();
  const mark = useFileMark(entry.path);
  const changed = !!mark?.changed;
  // What Textus AI left here waiting for the writer, said after the name.
  const waiting = mark?.pending
    ? plural(t.aiPendingCount, mark.pending, lang)
    : mark?.created
      ? t.aiCreatedPending
      : null;
  return (
    <>
      <div
        className={`tree-row tree-row-file${active ? " tree-row-active" : ""}${entry.ignored ? " tree-row-ignored" : ""}`}
        role="treeitem"
        aria-level={depth}
        aria-selected={active}
        data-ai-changed={changed || undefined}
        // Dropped on a file, a drag goes into that file's folder.
        data-drop-dir={parentDir(entry.path) ?? undefined}
        style={{ "--depth": depth } as CSSProperties}
        onClick={(e) => {
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
        <Tooltip text={entry.name} description={null} whenCut>
          <span className="tx-truncate tree-label">{entry.name}</span>
        </Tooltip>
        {waiting && <span className="tree-ai-waiting">{waiting}</span>}
      </div>
      <Presence show={!!press.at}>
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
});
