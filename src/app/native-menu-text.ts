import { APP_NAME, type Strings } from "../i18n/strings";
import type { HeadingAction, Shortcuts } from "../settings/SettingsContext";
import { buildAppMenu, NO_RECENTS, type MenuNode } from "./app-menu-model";

// What the macOS menu bar - native, built in Rust (src-tauri/src/menu.rs) -
// is sent to say and show: the labels of the app menu's model
// (app-menu-model.ts) for the same ids, and the user's keys.

/**
 * The macOS menu bar's labels, for menu.rs's set_menu_labels: the bar is
 * native there and built in Rust, in English unless sent these. Keyed by
 * native menu id - the app-drawn menu's own labels for the same ids, so
 * the two menus say the same thing - plus "menu:<name>" for each submenu
 * and "predefined:<name>" for the items muda makes (menu.rs's build).
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
 * The macOS menu bar's keys for the Format menu's heading levels, for
 * menu.rs's set_menu_accelerators: keyed by native menu id, written as muda
 * reads them, and only for the levels bound in Settings › Shortcuts. The
 * bar then shows the user's keys, and a level rebound or cleared there
 * keeps no native key that would go on firing.
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
  // CmdOrCtrl, never Cmd: see the accelerators in menu.rs's build.
  mod: "CmdOrCtrl",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Super",
};

/** "mod+shift+1" -> "CmdOrCtrl+Shift+1". muda reads key names in any case;
 *  one it can't read leaves the item without a key (menu.rs). */
function nativeAccelerator(combo: string): string {
  return combo
    .split("+")
    .map((part) => NATIVE_MODIFIERS[part] ?? part)
    .join("+");
}
