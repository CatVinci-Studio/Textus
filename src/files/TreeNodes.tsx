import { explainError } from "../utils/error-explain";
import { currentStrings } from "../i18n/current";
// The file tree's folders: each reads and lists its entries, drawing a
// row for each (TreeRows.tsx).

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { type DirEntryInfo } from "../platform/bindings/files";
import { fs } from "../platform/ipc";
import { useSettings } from "../prefs/SettingsContext";
import { isInside, onTheWay } from "../utils/path";
import { isDocumentName } from "./document-name";
import {
  folderDocumentAround,
  folderDocumentOf,
  useFolderDocumentKinds,
} from "./folder-documents";
import { localeOf } from "../i18n/langs";
import { compareEntries, nameCollator } from "../utils/name-order";
import { useTree, type TreeShared } from "./tree-shared";
import { isWithin } from "../utils/path";
import { DraftRow } from "./DraftRow";
import { FileNode, FolderRow } from "./TreeRows";
import { TreeRowsInSight } from "./TreeRowsInSight";
import { RowsMakeRoom } from "../engine/motion/RowsMakeRoom";
import type { FileOpenHow } from "./tree-shared";

/** How long something dragged rests on a folded folder before it opens. */
const OPEN_UNDER_DRAG_MS = 500;
/** How many levels of folders stay at the top while their rows scroll by. */
const STICKY_LEVELS = 5;

interface DirNodeProps {
  path: string;
  depth: number;
  /** Left out by a .gitignore: shown dimmed, as the search leaves it out. */
  ignored?: boolean;
  /** A dot name (or marked hidden): shown muted, as a file manager does. */
  hidden?: boolean;
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

/** Whether a folder is open, and what is being named in it. The root is
 *  always open; a folder opens on the way to the open document, a folder
 *  asked to be shown, or something made or being named in or below it, and
 *  folds with Collapse All. Its being open is told to the disk watch. */
function useFolderOpen(
  tree: TreeShared,
  path: string,
  depth: number,
  activePath: string | null,
) {
  const version = tree.versions[path] ?? 0;
  // The root is always open, and so is a folder on the way down to the open
  // document.
  const [open, setOpen] = useState(
    depth === 0 || (activePath !== null && isInside(activePath, path)),
  );
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
  // Only a change since Collapse All, or since it was drawn, opens it: a
  // folder drawn again keeps the fold Collapse All gave it.
  const drafting = tree.draft?.dir === path ? tree.draft.kind : null;
  const draftBelow = !!tree.draft && isInside(tree.draft.dir, path);
  const versionSeen = useRef(tree.collapsed[path] ?? 0);
  useEffect(() => {
    const grew = version > versionSeen.current;
    versionSeen.current = version;
    if (grew || drafting || draftBelow) setOpen(true);
  }, [version, drafting, draftBelow]);
  // Collapse All folds it; a folder drawn after keeps its own state.
  const collapsedSeen = useRef(tree.collapsed);
  useEffect(() => {
    if (collapsedSeen.current === tree.collapsed) return;
    collapsedSeen.current = tree.collapsed;
    versionSeen.current = version;
    if (depth > 0) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the version as it folds
  }, [tree.collapsed, depth]);
  const { openFolders } = tree;
  useEffect(
    () => (open ? openFolders.add(path) : undefined),
    [open, path, openFolders],
  );
  return [open, setOpen, drafting] as const;
}

export const DirNode = memo(function DirNode({
  path,
  depth,
  ignored = false,
  hidden = false,
  activePath,
  onFileSelect,
}: DirNodeProps) {
  const tree = useTree();
  const version = tree.versions[path] ?? 0;
  const listing = `${version}:${tree.stale[path] ?? 0}:${tree.refreshed}`;
  const [open, setOpen, drafting] = useFolderOpen(
    tree,
    path,
    depth,
    activePath,
  );
  const [loaded, setLoaded] = useState<{
    listing: string;
    entries: DirEntryInfo[];
    /** Why it couldn't be read, in the UI's language. */
    failed?: string;
  } | null>(null);

  useEffect(() => {
    // Folded, it is not watched: read again when it next opens.
    if (!open && loaded?.listing) setLoaded({ ...loaded, listing: "" });
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
  const onWay = onTheWay(activePath, tree.reveal, tree.draft?.dir);
  // Something dragged would go in here: the folder with all its rows lit as
  // one, and a folded one opens if the pointer stays.
  const dropping = depth > 0 && tree.dropInto === path;
  useEffect(() => {
    if (!dropping || open) return;
    const timer = window.setTimeout(() => setOpen(true), OPEN_UNDER_DRAG_MS);
    return () => window.clearTimeout(timer);
  }, [dropping, open, setOpen]);

  // Opened, folded, a row added or gone, a name being typed: the tree's
  // rows make room. The window's folder filling the tree is not a change.
  const node = useRef<HTMLDivElement>(null);
  const shape =
    depth === 0 && !sorted
      ? null
      : `${open}:${sorted?.length ?? "-"}:${drafting ?? ""}`;

  return (
    <div
      ref={node}
      className={`dir-node${dropping ? " tx-drop-into" : ""}`}
      data-drop-dir={depth > 0 ? path : undefined}
      style={
        depth === 0
          ? ({ "--tree-sticky-levels": STICKY_LEVELS } as CSSProperties)
          : undefined
      }
    >
      <RowsMakeRoom
        watch={shape}
        root={() => node.current?.closest('[role="tree"]') ?? null}
        rows=".tree-row"
      />
      {depth > 0 && (
        // Scrolled into, the folder's row stays at the top under its own
        // folders' until its last row goes by (FileTree.css).
        <div
          className={`tree-head${depth <= STICKY_LEVELS ? " tree-head-sticky" : ""}`}
          style={{ "--depth": depth } as CSSProperties}
        >
          <FolderRow
            path={path}
            depth={depth}
            open={open}
            ignored={ignored}
            hidden={hidden}
            onToggle={() => setOpen(!open)}
          />
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
                  hidden={entry.hidden}
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
