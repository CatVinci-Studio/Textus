import type { Strings } from "../../i18n/strings";
import { PANDOC_FORMATS } from "../export-formats";
import type { HeadingAction, Shortcuts } from "../../prefs/SettingsContext";
import { basename } from "../../utils/path";

import type { MenuNode, RecentLists } from "./app-menu-model";
import { pluginMenuNodes, type PluginMenuEntry } from "./plugin-menu";

/** Parts of the menus built from what is open now: File › Open Recent and
 *  Export, Format's entries, the Plugins menu. */

/** Recent files by name, full path on hover. A folder's name ends in a
 *  separator to tell it from the files. */
export function recentEntries(t: Strings, recents: RecentLists): MenuNode[] {
  const { files, folders } = recents;
  if (files.length === 0 && folders.length === 0) {
    return [{ label: t.menuRecentNone, disabled: true }];
  }
  const folderNodes = folders.map((path): MenuNode => {
    const trimmed = path.replace(/[\\/]+$/, "");
    const sep = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
    return {
      label: `${basename(trimmed) || trimmed}${sep}`,
      title: path,
      action: { native: `recent-folder:${path}` },
    };
  });
  const fileNodes = files.map((path): MenuNode => ({
    label: basename(path) || path,
    title: path,
    action: { native: `recent:${path}` },
  }));
  return [
    ...folderNodes,
    ...(folderNodes.length && fileNodes.length ? ["separator" as const] : []),
    ...fileNodes,
    "separator",
    { label: t.menuRecentClear, action: { native: "recent-clear" } },
  ];
}

/** File › Export: PDF and HTML, then the pandoc formats (one list:
 *  export-formats.json). */
export function exportEntries(t: Strings): MenuNode[] {
  const pandoc: [string, string][] = PANDOC_FORMATS.map((f) => [
    f.format,
    t[f.key],
  ]);
  return [
    {
      label: t.menuExportPdf,
      accel: "mod+p",
      action: { native: "export-pdf" },
    },
    { label: t.menuExportHtml, action: { native: "export-html" } },
    "separator",
    ...pandoc.map(([format, label]): MenuNode => ({
      label,
      action: { native: `export-pandoc:${format}` },
    })),
  ];
}

/** Format › Highlight's key, fixed as Bold's and Italic's are: the editor
 *  answers it itself (format-shortcut-plugin.ts), and menu/build.rs gives
 *  the macOS item the same. */
const HIGHLIGHT_COMBO = "mod+shift+h";

export function formatEntries(t: Strings, shortcuts: Shortcuts): MenuNode[] {
  const headings = [1, 2, 3, 4, 5, 6].map((level): MenuNode => ({
    label: t.menuHeadingTemplate.replace("{n}", String(level)),
    accel: shortcuts[`setHeading${level}` as HeadingAction] || undefined,
    action: { native: `insert-block:h${level}` },
  }));
  const blocks: [string, string][] = [
    ["bullet-list", t.menuBulletList],
    ["ordered-list", t.menuOrderedList],
    ["blockquote", t.menuBlockquote],
    ["code-block", t.menuCodeBlock],
    ["table", t.menuTable],
  ];
  return [
    {
      label: t.toolbarHighlight,
      accel: HIGHLIGHT_COMBO,
      action: { native: "toggle-mark:highlight" },
    },
    // Typora's keys: Control on a Mac too, where Cmd+` is the system's.
    {
      label: t.menuStrikethrough,
      accel: "ctrl+shift+`",
      action: { native: "toggle-mark:strikethrough" },
    },
    {
      label: t.menuInlineCode,
      accel: "ctrl+`",
      action: { native: "toggle-mark:code" },
    },
    {
      label: t.menuInsertLink,
      accel: "mod+k",
      action: { native: "insert-link" },
    },
    "separator",
    ...headings,
    "separator",
    ...blocks.map(([kind, label]): MenuNode => ({
      label,
      action: { native: `insert-block:${kind}` },
    })),
  ];
}

/** The Plugins menu: plugin commands, then Manage Plugins…. */
export function pluginsMenu(
  t: Strings,
  plugins: readonly PluginMenuEntry[],
): MenuNode[] {
  return [
    {
      label: t.menuPlugins,
      submenu: [
        ...(plugins.length
          ? pluginMenuNodes(plugins)
          : [{ label: t.menuNoPluginCommands, disabled: true }]),
        "separator",
        { label: t.menuManagePlugins, action: { native: "manage-plugins" } },
      ],
    },
  ];
}
