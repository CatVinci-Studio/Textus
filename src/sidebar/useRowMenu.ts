import {
  useCallback,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { fs } from "../platform/ipc";

import { basename, parentDir } from "../utils/path";
import { type ContextMenuItem } from "../ui/ContextMenu";
import { contributedContextItems } from "../ui/context-menu-items";
import { showConfirm, showMessage, showPrompt } from "../ui/app-dialog";
import type { Strings } from "../i18n/strings";
import { failureText, type TreeDraft } from "./tree-shared";
import { updateLinksAfterMove } from "./move-links";
import { pathItems } from "../clipboard/copy-path";
import type { FileOpenHow } from "./tree-shared";

/** A row's right-click menu, while it is open. */
type TreeMenu = {
  x: number;
  y: number;
  items: (ContextMenuItem | "separator")[];
} | null;

/** The tree's menus: the one open, and a row's context menu - open, new
 *  document or folder, rename, move to Trash. */
export function useRowMenu(
  root: string,
  linkBase: string,
  t: Strings,
  reload: (...dirs: string[]) => void,
  onFileSelect: (path: string, how?: FileOpenHow) => void,
  onEntryMoved: (from: string, to: string) => void,
  setDraft: (draft: TreeDraft) => void,
  /** The tree narrowed to a folder inside it. */
  onEnter: (path: string) => void,
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
      const ok = await showConfirm(
        (isDir ? t.treeTrashFolderConfirm : t.treeTrashConfirm).replace(
          "{name}",
          name,
        ),
        { okLabel: t.treeTrash, cancelLabel: t.cancel, danger: true },
      );
      if (!ok) return;
      try {
        await fs.trashEntry(path, root);
        reload(parentDir(path) ?? root);
      } catch (err) {
        await showMessage(failureText(t, err, name));
      }
    },
    [root, t, reload],
  );

  const onRowMenu = useCallback(
    (e: ReactMouseEvent, path: string, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      // New things go into the folder clicked, or the one the file is in.
      const dir = isDir ? path : (parentDir(path) ?? root);
      const items: (ContextMenuItem | "separator")[] = [];
      if (path !== root && !isDir)
        items.push(
          { label: t.treeOpen, onSelect: () => onFileSelect(path) },
          { label: t.openBeside, onSelect: () => onFileSelect(path, "beside") },
          "separator",
        );
      if (path !== root && isDir)
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
        items.push(
          { label: t.treeRenameItem, onSelect: () => void rename(path) },
          {
            label: t.treeTrashItem,
            onSelect: () => void trash(path, isDir),
            danger: true,
          },
        );
      const added = contributedContextItems("file/context", { path });
      if (added.length) items.push("separator", ...added);
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [root, t, setDraft, rename, trash, onFileSelect, onEnter],
  );
  return { menu, setMenu, onRowMenu };
}
