import {
  useCallback,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { isMobileApp } from "../platform/capabilities";
import { nativeFiles } from "../platform/native-files";

import { basename, parentDir } from "../utils/path";
import { type ContextMenuItem } from "../engine/controls/ContextMenu";
import {
  contributedContextItems,
  lateContextItems,
} from "../registry/context-menu-items";
import type { Strings } from "../i18n/strings";
import { trashable, type TreeDraft } from "./tree-shared";
import { linkingDocument, linkToFile } from "./link-to-file";
import { pathItems } from "../clipboard/copy-path";
import { heldByFinger } from "../utils/gesture";
import type { FileOpenHow } from "./tree-shared";
import { type TreeRow, type TreeSelection } from "./tree-selection";
import type { FileUndo } from "./useFileUndo";
import { useTreeTrash } from "./useTreeTrash";
import { useTreeCommands } from "./useTreeCommands";

/** A row's right-click menu, while it is open. */
type TreeMenu = {
  x: number;
  y: number;
  items: (ContextMenuItem | "separator")[];
  /** The row's name, heading a phone's sheet. */
  title?: string;
} | null;

/** The tree's menus: the one open, and a row's context menu - open, new
 *  document or folder, rename, move to Trash. */
export function useRowMenu(input: {
  root: string;
  linkBase: string;
  t: Strings;
  reload: (...dirs: string[]) => void;
  onFileSelect: (path: string, how?: FileOpenHow) => void;
  setDraft: (draft: TreeDraft) => void;
  /** The tree narrowed to a folder inside it; null with a folder opened:
   *  the tree shows it whole. */
  onEnter: ((path: string) => void) | null;
  /** The rows picked together, which a right-click on one of them acts on. */
  selection: TreeSelection;
  fileUndo: FileUndo;
  /** The row's name made a field to type a new one in. */
  rename: (path: string) => void;
  treeRef: RefObject<HTMLDivElement | null>;
}) {
  const { root, linkBase, t, onFileSelect, setDraft, onEnter } = input;
  const { selection, rename } = input;
  const [menu, setMenu] = useState<TreeMenu>(null);
  const { askTrash } = useTreeTrash(input);
  const onCommandKey = useTreeCommands({
    treeRef: input.treeRef,
    selection,
    rename,
    open: (path) => onFileSelect(path),
    trash: (rows) => void askTrash(rows),
  });

  /** The menu of several rows picked together: open its documents, or
   *  move them all to the Trash. */
  const openGroupMenu = useCallback(
    (at: { x: number; y: number }, rows: readonly TreeRow[]) => {
      const files = rows.filter((row) => !row.isDir).map((row) => row.path);
      const items: (ContextMenuItem | "separator")[] = [];
      if (files.length)
        items.push(
          {
            label: t.treeOpen,
            onSelect: () => files.forEach((path) => onFileSelect(path)),
          },
          "separator",
        );
      items.push({
        label: t.treeTrash,
        onSelect: () => void askTrash(rows),
        danger: true,
      });
      setMenu({ ...at, items });
    },
    [t, onFileSelect, askTrash],
  );

  const openRowMenu = useCallback(
    (at: { x: number; y: number }, path: string, isDir: boolean) => {
      // New things go into the folder clicked, or the one the file is in.
      const dir = isDir ? path : (parentDir(path) ?? root);
      const items: (ContextMenuItem | "separator")[] = [];
      // Into the document in use; not while it is unsaved or read-only.
      const linkFrom = isDir ? null : linkingDocument();
      if (path !== root && !isDir)
        items.push(
          // Beside another document: drag it there.
          { label: t.treeOpen, onSelect: () => onFileSelect(path) },
          {
            label: t.treeInsertLink,
            disabled: !linkFrom || linkFrom === path,
            onSelect: () => {
              if (linkFrom) void linkToFile(path, linkFrom, linkBase);
            },
          },
          ...(isMobileApp
            ? [
                {
                  label: t.menuShare,
                  onSelect: () => void nativeFiles.share(path).catch(() => {}),
                },
              ]
            : []),
          "separator",
        );
      if (path !== root && isDir && onEnter)
        items.push(
          { label: t.treeShowOnlyFolder, onSelect: () => onEnter(path) },
          "separator",
        );
      items.push(
        {
          label: t.menuNewFile,
          onSelect: () => setDraft({ dir, kind: "document" }),
        },
        {
          label: t.treeNewFolder,
          onSelect: () => setDraft({ dir, kind: "folder" }),
        },
      );
      items.push("separator", ...pathItems(t, path, root));
      if (path !== root)
        items.push({
          label: t.treeRenameItem,
          onSelect: () => rename(path),
        });
      // Without a Trash only documents are deleted: a folder's would be gone
      // for good.
      if (path !== root && (trashable(path) || !isDir))
        items.push({
          label: trashable(path) ? t.treeTrash : t.docDelete,
          onSelect: () => void askTrash([{ path, isDir }]),
          danger: true,
        });
      const added = contributedContextItems("file/context", {
        path,
        folder: isDir,
      });
      if (added.length) items.push("separator", ...added);
      setMenu({ ...at, items, title: basename(path) });
      // What plugins work out for this file joins the menu once they answer.
      void lateContextItems("file/context", { path, folder: isDir })?.then(
        (late) => {
          if (!late.length) return;
          setMenu((open) =>
            open?.items === items
              ? {
                  ...open,
                  items: [
                    ...items,
                    ...(added.length ? [] : ["separator" as const]),
                    ...late,
                  ],
                }
              : open,
          );
        },
      );
    },
    [root, linkBase, t, setDraft, rename, askTrash, onFileSelect, onEnter],
  );
  const onRowMenu = useCallback(
    (e: ReactMouseEvent, path: string, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      // Android's hold sends one too: a finger's hold is the drag's.
      if (heldByFinger(e.nativeEvent)) return;
      const at = { x: e.clientX, y: e.clientY };
      const group = selection.groupOf(path);
      if (group) return openGroupMenu(at, group);
      selection.clear();
      openRowMenu(at, path, isDir);
    },
    [openRowMenu, openGroupMenu, selection],
  );
  return { menu, setMenu, onRowMenu, openRowMenu, onCommandKey };
}
