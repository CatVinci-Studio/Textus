import { useEffect, useMemo, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ProjectEntry } from "../../platform/ipc";
import {
  ChevronIcon,
  FolderIcon,
  GenericFileIcon,
  RefreshIcon,
} from "../../ui/icons";

/** Files the tree draws at most; a huge folder says how many it left out. */
const SHOWN_LIMIT = 600;

interface Folder {
  name: string;
  path: string;
  folders: Folder[];
  files: ProjectEntry[];
}

function buildTree(entries: ProjectEntry[]): Folder {
  const root: Folder = { name: "", path: "", folders: [], files: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let next = folder.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, path, folders: [], files: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.files.push(entry);
  }
  return root;
}

/** Every file under a folder that can be ticked (anything but "other"). */
function selectable(folder: Folder): string[] {
  return [
    ...folder.files.filter((f) => f.kind !== "other").map((f) => f.path),
    ...folder.folders.flatMap(selectable),
  ];
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TAG: Record<string, string> = {
  docx: "Word",
  pdf: "PDF",
  pptx: "PPT",
  xlsx: "Excel",
  xls: "Excel",
  csv: "CSV",
};

/**
 * The project folder as a tree (auto-writing): every file, its kind and
 * size, pictures as thumbnails. Ticked text and documents are the plan's
 * material; ticked pictures are offered to the sections that fit them.
 */
export function ProjectFiles({
  root,
  entries,
  selected,
  zh,
  onToggle,
  onOpenFolder,
  onRefresh,
}: {
  /** The folder in use, or null when there is none yet. */
  root: string | null;
  /** null while loading. */
  entries: ProjectEntry[] | null;
  selected: ReadonlySet<string>;
  zh: boolean;
  onToggle: (paths: string[], on: boolean) => void;
  onOpenFolder: () => void;
  onRefresh: () => void;
}) {
  const shown = useMemo(() => (entries ?? []).slice(0, SHOWN_LIMIT), [entries]);
  const tree = useMemo(() => buildTree(shown), [shown]);
  const folderName = root?.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const counts = useMemo(() => {
    let material = 0;
    let pictures = 0;
    for (const entry of entries ?? [])
      if (selected.has(entry.path)) {
        if (entry.kind === "image") pictures++;
        else material++;
      }
    return { material, pictures };
  }, [entries, selected]);

  if (!root)
    return (
      <div className="project-files is-empty">
        <FolderIcon />
        <p>
          {zh
            ? "打开一个项目文件夹：大纲、要求、资料（文本、Word、PDF）和图片都放在里面。"
            : "Open a project folder holding your outline, requirements, material (text, Word, PDF) and pictures."}
        </p>
        <button type="button" className="is-primary" onClick={onOpenFolder}>
          {zh ? "打开文件夹" : "Open folder"}
        </button>
      </div>
    );

  return (
    <div className="project-files">
      <div className="project-files-head">
        <FolderIcon />
        <strong title={root}>{folderName}</strong>
        <span className="project-files-count">
          {entries
            ? zh
              ? `${entries.length} 个文件`
              : `${entries.length} files`
            : ""}
        </span>
        <button
          type="button"
          className="project-files-icon"
          aria-label={zh ? "刷新" : "Refresh"}
          title={zh ? "刷新" : "Refresh"}
          onClick={onRefresh}
        >
          <RefreshIcon />
        </button>
        <button type="button" onClick={onOpenFolder}>
          {zh ? "换文件夹" : "Change"}
        </button>
      </div>
      {entries === null ? (
        <div className="project-files-loading" />
      ) : entries.length === 0 ? (
        <p className="project-files-none">
          {zh ? "这个文件夹里还没有文件。" : "This folder has no files yet."}
        </p>
      ) : (
        <div className="project-files-tree" role="tree">
          <FolderBody
            folder={tree}
            depth={0}
            root={root}
            selected={selected}
            zh={zh}
            onToggle={onToggle}
          />
          {entries.length > SHOWN_LIMIT && (
            <p className="project-files-more">
              {zh
                ? `另有 ${entries.length - SHOWN_LIMIT} 个文件未显示`
                : `${entries.length - SHOWN_LIMIT} more files not shown`}
            </p>
          )}
        </div>
      )}
      {entries && entries.length > 0 && (
        <p className="project-files-summary">
          {zh
            ? `已选资料 ${counts.material} 份 · 图片 ${counts.pictures} 张`
            : `${counts.material} material files · ${counts.pictures} pictures selected`}
        </p>
      )}
    </div>
  );
}

function FolderBody({
  folder,
  depth,
  root,
  selected,
  zh,
  onToggle,
}: {
  folder: Folder;
  depth: number;
  root: string;
  selected: ReadonlySet<string>;
  zh: boolean;
  onToggle: (paths: string[], on: boolean) => void;
}) {
  return (
    <>
      {folder.folders.map((child) => (
        <FolderNode
          key={child.path}
          folder={child}
          depth={depth}
          root={root}
          selected={selected}
          zh={zh}
          onToggle={onToggle}
        />
      ))}
      {folder.files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          depth={depth}
          root={root}
          checked={selected.has(file.path)}
          zh={zh}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

function FolderNode({
  folder,
  depth,
  root,
  selected,
  zh,
  onToggle,
}: {
  folder: Folder;
  depth: number;
  root: string;
  selected: ReadonlySet<string>;
  zh: boolean;
  onToggle: (paths: string[], on: boolean) => void;
}) {
  const paths = useMemo(() => selectable(folder), [folder]);
  const ticked = paths.filter((p) => selected.has(p)).length;
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current)
      box.current.indeterminate = ticked > 0 && ticked < paths.length;
  }, [ticked, paths.length]);
  return (
    <details
      className="project-folder"
      open={depth === 0 || ticked > 0}
      style={{ "--depth": depth } as React.CSSProperties}
    >
      <summary role="treeitem">
        <ChevronIcon className="project-folder-chevron" />
        <input
          ref={box}
          type="checkbox"
          className="ui-check"
          aria-label={zh ? `选择「${folder.name}」` : `Select "${folder.name}"`}
          checked={paths.length > 0 && ticked === paths.length}
          disabled={paths.length === 0}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggle(paths, e.target.checked)}
        />
        <FolderIcon className="project-folder-icon" />
        <span className="project-file-name">{folder.name}</span>
        <span className="project-file-meta">{paths.length}</span>
      </summary>
      <FolderBody
        folder={folder}
        depth={depth + 1}
        root={root}
        selected={selected}
        zh={zh}
        onToggle={onToggle}
      />
    </details>
  );
}

function FileRow({
  file,
  depth,
  root,
  checked,
  zh,
  onToggle,
}: {
  file: ProjectEntry;
  depth: number;
  root: string;
  checked: boolean;
  zh: boolean;
  onToggle: (paths: string[], on: boolean) => void;
}) {
  const name = file.path.split("/").pop() ?? file.path;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const thumb = useMemo(
    () =>
      file.kind === "image"
        ? convertFileSrc(`${root.replace(/[\\/]+$/, "")}/${file.path}`)
        : null,
    [file.kind, file.path, root],
  );
  return (
    <label
      className={`project-file is-${file.kind}`}
      role="treeitem"
      style={{ "--depth": depth } as React.CSSProperties}
      title={
        file.kind === "other"
          ? zh
            ? "这种文件无法读取"
            : "This kind of file can't be read"
          : file.path
      }
    >
      <input
        type="checkbox"
        className="ui-check"
        checked={checked}
        disabled={file.kind === "other"}
        onChange={(e) => onToggle([file.path], e.target.checked)}
      />
      {thumb ? (
        <img
          className="project-file-thumb"
          src={thumb}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : (
        <GenericFileIcon className="project-file-icon" />
      )}
      <span className="project-file-name">{name}</span>
      {file.kind === "document" && TAG[ext] && (
        <span className="project-file-tag">{TAG[ext]}</span>
      )}
      <span className="project-file-meta">{size(file.bytes)}</span>
    </label>
  );
}
