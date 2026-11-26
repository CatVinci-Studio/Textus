import type { ContextMenuItem } from "../engine/controls/ContextMenu";
import type { Strings } from "../i18n/strings";
import { copyPath } from "../clipboard/copy-path";
import { farEntries } from "../platform/far-files";
import { fileClipboard } from "./file-clipboard";
import type { TreeRow } from "./tree-selection";
import type { TreeClipboard } from "./useTreeClipboard";

type Item = ContextMenuItem | "separator";

/** Cut, Copy, Paste and Duplicate for `rows` (none for the tree's own
 *  folder), Paste going into `into`. A plugin's folder has none: its files
 *  move by its own rules. */
export function clipboardItems(
  t: Strings,
  clip: TreeClipboard,
  rows: readonly TreeRow[],
  into: string | null,
): Item[] {
  if ([...rows.map((r) => r.path), into ?? ""].some((p) => p && farEntries(p)))
    return [];
  const items: Item[] = [];
  if (rows.length)
    items.push(
      { label: t.cut, onSelect: () => clip.cutOrCopy(rows, true) },
      { label: t.copy, onSelect: () => clip.cutOrCopy(rows, false) },
    );
  if (into !== null)
    items.push({
      label: t.paste,
      disabled: !fileClipboard.get(),
      onSelect: () => void clip.paste(into),
    });
  if (rows.length)
    items.push({
      label: t.treeDuplicate,
      onSelect: () => clip.duplicate(rows),
    });
  return items;
}

/**
 * The menu of several rows picked together: open its documents; cut, copy
 * or duplicate them; copy their paths, one a line; or move them all to the
 * Trash.
 */
export function groupMenuItems(input: {
  t: Strings;
  rows: readonly TreeRow[];
  open: (path: string) => void;
  clip: TreeClipboard;
  trash: (rows: readonly TreeRow[]) => void;
}): Item[] {
  const { t, rows } = input;
  const files = rows.filter((row) => !row.isDir).map((row) => row.path);
  const items: Item[] = [];
  if (files.length)
    items.push(
      { label: t.treeOpen, onSelect: () => files.forEach(input.open) },
      "separator",
    );
  const clipboard = clipboardItems(t, input.clip, rows, null);
  if (clipboard.length) items.push(...clipboard, "separator");
  items.push(
    {
      label: t.menuCopyPath,
      onSelect: () => copyPath(rows.map((row) => row.path).join("\n")),
    },
    "separator",
    { label: t.treeTrash, onSelect: () => input.trash(rows), danger: true },
  );
  return items;
}
