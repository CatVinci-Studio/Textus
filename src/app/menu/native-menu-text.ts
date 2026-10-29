import { APP_NAME, type Strings } from "../../i18n/strings";
import type { HeadingAction, Shortcuts } from "../../prefs/SettingsContext";
import { buildAppMenu, NO_RECENTS, type MenuNode } from "./app-menu-model";

/**
 * The macOS menu bar's labels, which is native and English unless sent
 * these: the app-drawn menu's labels by native id, plus "menu:<name>" for
 * submenus and "predefined:<name>" for muda's items.
 */
export function nativeMenuLabels(t: Strings): Record<string, string> {
  const labels: Record<string, string> = {};
  const collect = (nodes: MenuNode[]) => {
    for (const node of nodes) {
      if (node === "separator") continue;
      if (node.action && "native" in node.action)
        labels[node.action.native] = node.label;
      if (node.submenu) collect(node.submenu);
    }
  };
  // Accelerators play no part in a label.
  collect(buildAppMenu(t, {} as Shortcuts, NO_RECENTS));
  const named = (template: string) => template.replace("{name}", APP_NAME);
  return {
    ...labels,
    // macOS says Quit where Windows says Exit.
    quit: named(t.menuQuit),
    "recent-none": t.menuRecentNone,
    "recent-clear": t.menuRecentClear,
    "menu:file": t.menuFile,
    "menu:open-recent": t.menuOpenRecent,
    "menu:export": t.menuExport,
    "menu:edit": t.menuEdit,
    "menu:format": t.menuFormat,
    "menu:view": t.menuView,
    "menu:plugins": t.menuPlugins,
    "plugin-commands-none": t.menuNoPluginCommands,
    "menu:window": t.menuWindow,
    "menu:help": t.menuHelp,
    "predefined:about": named(t.menuAbout),
    "check-updates": `${t.updateCheckButton}…`,
    "predefined:hide": named(t.menuHide),
    "predefined:hide-others": t.menuHideOthers,
    "predefined:show-all": t.menuShowAll,
    "predefined:undo": t.menuUndo,
    "predefined:redo": t.menuRedo,
    "predefined:cut": t.cut,
    "predefined:copy": t.copy,
    "predefined:paste": t.paste,
    "predefined:select-all": t.selectAll,
    "predefined:fullscreen": t.menuFullscreen,
    "predefined:minimize": t.windowMinimize,
    "predefined:maximize": t.menuZoomWindow,
    "predefined:bring-all-to-front": t.menuBringAllToFront,
  };
}

/**
 * The macOS menu bar's heading-level keys, only for levels bound in
 * Settings, so a rebound or cleared level keeps no native key firing.
 */
export function nativeMenuAccelerators(
  shortcuts: Shortcuts,
): Record<string, string> {
  const accelerators: Record<string, string> = {};
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const combo = shortcuts[`setHeading${level}` as HeadingAction];
    if (combo)
      accelerators[`insert-block:h${level}`] = nativeAccelerator(combo);
  }
  return accelerators;
}

const NATIVE_MODIFIERS: Record<string, string> = {
  // CmdOrCtrl, never Cmd, as the native menu is built.
  mod: "CmdOrCtrl",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Super",
};

/** "mod+shift+1" -> "CmdOrCtrl+Shift+1". A key muda can't read leaves the
 *  item without one. */
function nativeAccelerator(combo: string): string {
  return combo
    .split("+")
    .map((part) => NATIVE_MODIFIERS[part] ?? part)
    .join("+");
}
