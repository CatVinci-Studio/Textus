import { explainError } from "../utils/error-explain";
import { useFileBadge } from "../plugins/contributions/file-badges";
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
import { basename, isInside, onTheWay, parentDir } from "../utils/path";
import { isDocumentName } from "./document-name";
import {
  folderDocumentAround,
  folderDocumentOf,
  useFolderDocumentKinds,
} from "./folder-documents";
import { localeOf } from "../i18n/langs";
import { compareEntries, nameCollator } from "../utils/name-order";
import { useTree, useTreeRowActions } from "./tree-shared";
import { useRowPicked } from "./tree-selection";
import { isWithin } from "../utils/path";
import { DraftRow } from "./DraftRow";
import { TreeRowsInSight } from "./TreeRowsInSight";
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

/** `next`, keeping each entry of `was` that is unchanged, and `was` itself
 *  when none changed: a folder read again as the window comes to the front
 *  draws none of its rows again. */
function keptEntries(
  was: DirEntryInfo[] | undefined,
  next: DirEntryInfo[],
): DirEntryInfo[] {
  if (!was) return next;
  const known = new Map(was.map((e) => [e.path, e]));
  const same = (a: DirEntryInfo, b: DirEntryInfo) =>
    (Object.keys(b) as (keyof DirEntryInfo)[]).every((k) => a[k] === b[k]);
  let changed = was.length !== next.length;
  const kept = next.map((entry, i) => {
    const old = known.get(entry.path);
    if (old && same(old, entry)) {
      if (was[i] !== old) changed = true;
      return old;
    }
    changed = true;
    return entry;
  });
  return changed ? kept : was;
}

/** Newest first; one the system gave no date for goes last. */
function byModified(a: DirEntryInfo, b: DirEntryInfo): number {
  return (b.modified_ms ?? -Infinity) - (a.modified_ms ?? -Infinity);
}

/** A folder's entries as the tree shows them: in the file manager's order
 *  for the UI language, not byte order ("第2章" before "第10章"), folders
 *  first; drawn again when a plugin opening folders as documents comes. */
function useShownEntries(
  entries: DirEntryInfo[] | null,
  tree: Pick<ReturnType<typeof useTree>, "showHidden" | "scope" | "sort">,
): DirEntryInfo[] | null {
  const { settings } = useSettings();
  const collator = nameCollator(localeOf(settings.language));
  const folderDocuments = useFolderDocumentKinds();
  const { showHidden, scope, sort } = tree;
  return useMemo(() => {
    if (!entries) return null;
    const shown = entries.filter(
      (entry) =>
        (showHidden || !entry.hidden) &&
        (entry.is_dir || scope === "all" || isDocumentName(entry.name)),
    );
    return shown.sort(
      (a, b) =>
        (sort === "modified" && a.is_dir === b.is_dir ? byModified(a, b) : 0) ||
        compareEntries(collator, a, b),
    );
    // A plugin's kinds change what the rows are, not this list's inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, collator, showHidden, scope, sort, folderDocuments]);
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
      (entries) =>
        !cancelled &&
        setLoaded((was) => ({
          listing,
          entries: keptEntries(was?.entries, entries),
        })),
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
  const sorted = useShownEntries(loaded?.entries ?? null, tree);

  // Rows that must be drawn: the open document's, and the way to it.
  const onWay = onTheWay(activePath, tree.reveal);

  return (
    <div className="dir-node">
      {depth > 0 && (
        <FolderRow
          path={path}
          depth={depth}
          open={open}
          ignored={ignored}
          dropping={tree.dropInto === path}
          onToggle={() => setOpen(!open)}
        />
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
          <TreeRowsInSight
            dir={path}
            entries={sorted}
            needed={(entry) => onWay(entry.path)}
            row={(entry) =>
              entry.is_dir && !folderDocumentOf(entry.name) ? (
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
                  active={
                    entry.path === activePath ||
                    entry.path === folderDocumentAround(activePath)
                  }
                  onSelect={onFileSelect}
                />
              )
            }
          />
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
  const tree = useTreeRowActions();
  // A folder opened as one document shows its document's icon.
  const Icon = fileIconFor(folderDocumentOf(entry.name)?.[0] ?? entry.name);
  const picked = useRowPicked(entry.path);
  const mark = useFileMark(entry.path);
  const badge = useFileBadge(entry.path);
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
        className={`tree-row tree-row-file${active ? " tree-row-active" : ""}${picked ? " tree-row-picked" : ""}${entry.ignored ? " tree-row-ignored" : ""}`}
        role="treeitem"
        aria-level={depth}
        aria-selected={active || picked}
        data-path={entry.path}
        data-ai-changed={changed || undefined}
        // Dropped on a file, a drag goes into that file's folder.
        data-drop-dir={parentDir(entry.path) ?? undefined}
        style={{ "--depth": depth } as CSSProperties}
        onClick={(e) => {
          if (tree.onRowPick?.(e, entry.path)) return;
          // A click looks (the preview tab); a double click keeps it.
          onSelect(entry.path, "preview");
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
      >
        <Icon className="tree-icon" />
        <Tooltip text={entry.name} description={null} whenCut>
          <span className="tx-truncate tree-label">{entry.name}</span>
        </Tooltip>
        {badge && (
          <Tooltip text={badge.tooltip ?? badge.text} description={null}>
            <span
              className={`tree-badge${badge.tone ? ` plugin-tone-${badge.tone}` : ""}`}
            >
              {badge.text}
            </span>
          </Tooltip>
        )}
        {waiting && <span className="tree-ai-waiting">{waiting}</span>}
      </div>
    </>
  );
});

/** A folder's own row: a click folds it, a right click or a held touch
 *  opens its menu, a press may start a drag. */
function FolderRow({
  path,
  depth,
  open,
  ignored,
  dropping,
  onToggle,
}: {
  path: string;
  depth: number;
  open: boolean;
  ignored: boolean;
  dropping: boolean;
  onToggle: () => void;
}) {
  const tree = useTreeRowActions();
  const picked = useRowPicked(path);
  return (
    <div
      className={`tree-row${dropping ? " tx-drop-into" : ""}${picked ? " tree-row-picked" : ""}${ignored ? " tree-row-ignored" : ""}`}
      role="treeitem"
      aria-level={depth}
      aria-expanded={open}
      aria-selected={picked}
      data-path={path}
      data-drop-dir={path}
      style={{ "--depth": depth } as CSSProperties}
      // A double click folds or unfolds it once, as a click does; going
      // into it is the row's menu's Show Only This Folder.
      onClick={(e) => {
        if (e.detail > 1) return;
        if (tree.onRowPick?.(e, path)) return;
        onToggle();
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
  );
}
