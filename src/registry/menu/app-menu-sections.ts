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

/** File › Export's pandoc formats (export-formats.json). */
export function pandocEntries(t: Strings): MenuNode[] {
  return PANDOC_FORMATS.map((f) => ({
    label: t[f.key],
    action: { native: `export-pandoc:${f.format}` },
  }));
}

/** Format's heading levels, each with the key Settings gives it. */
export function headingEntries(t: Strings, shortcuts: Shortcuts): MenuNode[] {
  return [1, 2, 3, 4, 5, 6].map((level) => ({
    label: t.menuHeadingTemplate.replace("{n}", String(level)),
    accel: shortcuts[`setHeading${level}` as HeadingAction] || undefined,
    action: { native: `insert-block:h${level}` },
  }));
}

/** The Plugins menu's entries: plugin commands, then Manage Plugins…. */
export function pluginEntries(
  t: Strings,
  plugins: readonly PluginMenuEntry[],
): MenuNode[] {
  return [
    ...(plugins.length
      ? pluginMenuNodes(plugins)
      : [{ label: t.menuNoPluginCommands, disabled: true }]),
    "separator",
    { label: t.menuManagePlugins, action: { native: "manage-plugins" } },
  ];
}

/** The Plugins menu, for the phone's flat list. */
export function pluginsMenu(
  t: Strings,
  plugins: readonly PluginMenuEntry[],
): MenuNode[] {
  return [{ label: t.menuPlugins, submenu: pluginEntries(t, plugins) }];
}
