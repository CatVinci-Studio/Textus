import type { Strings } from "../i18n/strings";
import type { ContextMenuItem } from "../engine/controls/ContextMenu";
import { canRevealInFileManager } from "../platform/capabilities";
import { exportDoc } from "../platform/ipc";
import { relativePath } from "../utils/path";

/** A file's full path to the clipboard: File > Copy Path, and a tab's and
 *  the file tree's right-click menus. */
export function copyPath(path: string): void {
  void navigator.clipboard.writeText(path).catch(() => {});
}

export function copyPathItem(t: Strings, path: string): ContextMenuItem {
  return { label: t.menuCopyPath, onSelect: () => copyPath(path) };
}

/** Where a file is, for a tab's and the file tree's menus: its path, its
 *  path from the open folder (`folder`, when there is one and it holds
 *  the file), and the file shown in the system's file manager. */
export function pathItems(
  t: Strings,
  path: string,
  folder: string | null,
): ContextMenuItem[] {
  const inFolder =
    folder !== null &&
    path !== folder &&
    !relativePath(folder, path).startsWith("..");
  return [
    copyPathItem(t, path),
    ...(inFolder
      ? [
          {
            label: t.menuCopyRelativePath,
            onSelect: () => copyPath(relativePath(folder, path)),
          },
        ]
      : []),
    ...(canRevealInFileManager
      ? [
          {
            label: t.imageReveal,
            onSelect: () => void exportDoc.revealInDir(path).catch(() => {}),
          },
        ]
      : []),
  ];
}
