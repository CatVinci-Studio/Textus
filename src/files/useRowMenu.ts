import { farEntries } from "../platform/far-files";
import { emitPluginEvent } from "../plugins/app-bridge";
import { ENTRY_TRASHED_EVENT, sendAppEvent } from "../utils/events";
import { fill } from "../i18n/fill";
import {
  useCallback,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { fs } from "../platform/ipc";
import { canTrashFiles, isMobileApp } from "../platform/capabilities";
import { nativeFiles } from "../platform/native-files";

import { basename, parentDir } from "../utils/path";
import { type ContextMenuItem } from "../engine/controls/ContextMenu";
import {
  contributedContextItems,
  lateContextItems,
} from "../registry/context-menu-items";
import {
  showConfirm,
  showMessage,
  showPrompt,
} from "../engine/controls/app-dialog";
import type { Strings } from "../i18n/strings";
import { failureText, type TreeDraft } from "./tree-shared";
import { updateLinksAfterMove } from "./move-links";
import { pathItems } from "../clipboard/copy-path";
import { heldByFinger } from "../utils/gesture";
import type { FileOpenHow } from "./tree-shared";
import { counted } from "../i18n/current";
import { outermost, type TreeRow, type TreeSelection } from "./tree-selection";

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
/** Whether `path` goes to a Trash; one in a phone's or a remote folder is
 *  deleted for good. */
const trashable = (path: string) => canTrashFiles && !farEntries(path);

export function useRowMenu(
  root: string,
  linkBase: string,
  t: Strings,
  reload: (...dirs: string[]) => void,
  onFileSelect: (path: string, how?: FileOpenHow) => void,
  onEntryMoved: (from: string, to: string) => void,
  setDraft: (draft: TreeDraft) => void,
  /** The tree narrowed to a folder inside it. */
  /** Null with a folder opened: the tree shows it whole. */
  onEnter: ((path: string) => void) | null,
  /** The rows picked together, which a right-click on one of them acts on. */
  selection: TreeSelection,
) {
  const [menu, setMenu] = useState<TreeMenu>(null);
  const rename = useCallback(
    async (path: string) => {
      const name = await showPrompt(t.treeRenamePrompt, basename(path), {
        okLabel: t.treeRename,
        cancelLabel: t.cancel,
      });
      if (!name?.trim() || name.trim() === basename(path)) return;
      try {
        const to = await fs.renameEntry(path, name);
        reload(parentDir(path) ?? root);
        // Open documents follow, as for a move.
        onEntryMoved(path, to);
        void updateLinksAfterMove(path, to, linkBase, t);
      } catch (err) {
        await showMessage(failureText(t, err, name.trim()));
      }
    },
    [root, linkBase, t, reload, onEntryMoved],
  );
  const trash = useCallback(
    async (path: string, isDir: boolean) => {
      const name = basename(path);
      // Without a Trash (Android, a remote folder) the document is deleted
      // for good.
      const hasTrash = trashable(path);
      const ok = await showConfirm(
        !hasTrash
          ? fill(t.docDeleteConfirm, { name })
          : fill(isDir ? t.treeTrashFolderConfirm : t.treeTrashConfirm, {
              name,
            }),
        {
          okLabel: !hasTrash ? t.docDeleteOk : t.treeTrash,
          cancelLabel: t.cancel,
          danger: true,
        },
      );
      if (!ok) return;
      try {
        await fs.trashEntry(path, root);
        reload(parentDir(path) ?? root);
        // Its open tabs let it go (useDocumentActions).
        sendAppEvent(ENTRY_TRASHED_EVENT, path);
        emitPluginEvent("fileDelete", { path });
      } catch (err) {
        await showMessage(failureText(t, err, name));
      }
    },
    [root, t, reload],
  );

  /** Several rows to the Trash at once, after one question; a row inside a
   *  picked folder goes with it. */
  const trashMany = useCallback(
    async (rows: readonly TreeRow[]) => {
      const ok = await showConfirm(
        counted(t.treeTrashManyConfirm, rows.length),
        { okLabel: t.treeTrash, cancelLabel: t.cancel, danger: true },
      );
      if (!ok) return;
      selection.clear();
      for (const { path } of outermost(rows)) {
        try {
          await fs.trashEntry(path, root);
          reload(parentDir(path) ?? root);
          sendAppEvent(ENTRY_TRASHED_EVENT, path);
          emitPluginEvent("fileDelete", { path });
        } catch (err) {
          await showMessage(failureText(t, err, basename(path)));
          return;
        }
      }
    },
    [root, t, reload, selection],
  );

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
        onSelect: () => void trashMany(rows),
        danger: true,
      });
      setMenu({ ...at, items });
    },
    [t, onFileSelect, trashMany],
  );

  const openRowMenu = useCallback(
    (at: { x: number; y: number }, path: string, isDir: boolean) => {
      // New things go into the folder clicked, or the one the file is in.
      const dir = isDir ? path : (parentDir(path) ?? root);
      const items: (ContextMenuItem | "separator")[] = [];
      if (path !== root && !isDir)
        items.push(
          // Beside another document: drag it there.
          { label: t.treeOpen, onSelect: () => onFileSelect(path) },
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
          label: t.treeNewDocument,
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
          onSelect: () => void rename(path),
        });
      // Without a Trash only documents are deleted: a folder's would be gone
      // for good.
      if (path !== root && (trashable(path) || !isDir))
        items.push({
          label: trashable(path) ? t.treeTrash : t.docDelete,
          onSelect: () => void trash(path, isDir),
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
    [root, t, setDraft, rename, trash, onFileSelect, onEnter],
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
  return { menu, setMenu, onRowMenu, openRowMenu };
}
