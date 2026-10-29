import type { Strings } from "../i18n/strings";
import type { ContextMenuItem } from "../ui/ContextMenu";

/** A file's full path to the clipboard: File > Copy Path, and a tab's and
 *  the file tree's right-click menus. */
export function copyPath(path: string): void {
  void navigator.clipboard.writeText(path).catch(() => {});
}

export function copyPathItem(t: Strings, path: string): ContextMenuItem {
  return { label: t.menuCopyPath, onSelect: () => copyPath(path) };
}
