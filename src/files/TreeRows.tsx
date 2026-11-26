import { memo, useLayoutEffect, useRef, type CSSProperties } from "react";
import { useFileBadge } from "../plugins/contributions/file-badges";
import { Tooltip } from "../engine/controls/Tooltip";
import { useFileMark } from "../registry/file-marks";
import { plural } from "../i18n/plural";
import { type DirEntryInfo } from "../platform/bindings/files";
import { ChevronIcon } from "../engine/controls/icons";
import { useSettings } from "../prefs/SettingsContext";
import { basename, parentDir } from "../utils/path";
import { folderDocumentOf } from "./folder-documents";
import { useTreeRowActions } from "./tree-shared";
import { useRowPicked } from "./tree-selection";
import type { FileOpenHow } from "./tree-shared";
import { FileIcon, FolderEntryIcon } from "../engine/controls/file-icons";
import { NameField } from "./NameField";
import { useRowRename } from "./useRename";
import { useRowCut } from "./file-clipboard";

// The file tree's own rows: a file's, and a folder's above its entries.

/** A file's row; drawn again only when what it shows changed. */
export const FileNode = memo(function FileNode({
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
  const picked = useRowPicked(entry.path);
  const rename = useRowRename(entry.path);
  const cut = useRowCut(entry.path);
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
        className={`tree-row tree-row-file${active ? " tree-row-active" : ""}${picked ? " tree-row-picked" : ""}${entry.ignored ? " tree-row-ignored" : ""}${cut ? " tree-row-cut" : ""}`}
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
        {/* A folder opened as one document shows its document's icon. */}
        <FileIcon
          name={folderDocumentOf(entry.name)?.[0] ?? entry.name}
          className="tree-icon"
        />
        {rename ? (
          <NameField
            initial={entry.name}
            isDir={false}
            label={t.treeRenamePrompt}
            commit={(name, byKey) => rename.commit(entry.path, name, byKey)}
            cancel={(byKey) => rename.cancel(entry.path, byKey)}
          />
        ) : (
          <Tooltip text={entry.name} description={null} whenCut>
            <span className="tx-truncate tree-label">{entry.name}</span>
          </Tooltip>
        )}
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
export function FolderRow({
  path,
  depth,
  open,
  ignored,
  onToggle,
}: {
  path: string;
  depth: number;
  open: boolean;
  ignored: boolean;
  onToggle: () => void;
}) {
  const { t } = useSettings();
  const tree = useTreeRowActions();
  const picked = useRowPicked(path);
  const rename = useRowRename(path);
  const cut = useRowCut(path);
  // Folded from the top, where it stayed while its rows scrolled by: the
  // row stays in sight, not left far above.
  const row = useRef<HTMLDivElement>(null);
  const folding = useRef(false);
  useLayoutEffect(() => {
    if (folding.current && !open)
      row.current?.scrollIntoView?.({ block: "nearest" });
    folding.current = false;
  }, [open]);
  return (
    <div
      ref={row}
      className={`tree-row${picked ? " tree-row-picked" : ""}${ignored ? " tree-row-ignored" : ""}${cut ? " tree-row-cut" : ""}`}
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
        folding.current = open;
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
      <FolderEntryIcon
        name={basename(path)}
        open={open}
        className="tree-icon"
      />
      {rename ? (
        <NameField
          initial={basename(path)}
          isDir
          label={t.treeRenamePrompt}
          commit={(name, byKey) => rename.commit(path, name, byKey)}
          cancel={(byKey) => rename.cancel(path, byKey)}
        />
      ) : (
        <Tooltip text={basename(path)} description={null} whenCut>
          <span className="tx-truncate tree-label">{basename(path)}</span>
        </Tooltip>
      )}
    </div>
  );
}
