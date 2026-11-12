import { fill } from "../../i18n/fill";
import { APP_NAME, type Strings } from "../../i18n/strings";
import type { HeadingAction, Shortcuts } from "../../prefs/SettingsContext";
import {
  headingEntries,
  pandocEntries,
} from "../../registry/menu/app-menu-sections";
import {
  MENU_TABLE,
  isMenu,
  isSection,
  isSeparator,
  labelKey,
  menuText,
  type TableItem,
  type TableNode,
} from "../../registry/menu/menu-table";

/**
 * The macOS menu bar's labels, which is native and English unless sent
 * these: every item of the menu table by its label key, "menu:<name>" for
 * submenus, and the texts no item has.
 */
export function nativeMenuLabels(t: Strings): Record<string, string> {
  const named = (text: string) => fill(text, { name: APP_NAME });
  const labels: Record<string, string> = {};
  const collect = (nodes: readonly TableNode[]) => {
    for (const node of nodes) {
      if (isSeparator(node)) continue;
      if (isSection(node)) {
        const entries =
          node.section === "headings"
            ? headingEntries(t, {} as Shortcuts)
            : node.section === "pandoc"
              ? pandocEntries(t)
              : [];
        for (const entry of entries)
          if (entry !== "separator" && entry.action && "native" in entry.action)
            labels[entry.action.native] = entry.label;
      } else if (isMenu(node)) {
        if (node.label) labels[`menu:${node.menu}`] = menuText(t, node.label);
        collect(node.items);
      } else {
        const item = node as TableItem;
        labels[labelKey(item)] =
          named(menuText(t, item.label)) + (item.suffix ?? "");
      }
    }
  };
  for (const menu of MENU_TABLE.bar) {
    if (menu.label) labels[`menu:${menu.menu}`] = menuText(t, menu.label);
    collect(menu.items);
  }
  for (const text of MENU_TABLE.texts)
    labels[text.key] = menuText(t, text.label);
  return labels;
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
