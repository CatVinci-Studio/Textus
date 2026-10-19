import { APP_NAME, type Strings } from "../i18n/strings";
import { defaultShortcuts, type Shortcuts } from "../settings/SettingsContext";
import { buildAppMenu, NO_RECENTS, type MenuNode } from "./app-menu-model";

/**
 * The shortcuts that can't be changed, as Settings › Shortcuts lists them
 * under the ones that can (#214).
 *
 * Read off the app menu's model, the one place their combos are written
 * down for the menus: with every configurable shortcut unbound, an entry
 * that still shows a combo has a fixed one. On top of that, the per-
 * platform differences that model leaves to menu.rs (macOS) and
 * useGlobalShortcuts (Linux), and the few fixed keys no menu item carries:
 * the editor's own (bold, italic, leaving a block) and macOS's tab keys.
 * fixed-shortcuts.test.ts holds this to menu.rs's accelerators.
 */

export type ShortcutPlatform = "macos" | "ios" | "windows" | "linux";

export interface FixedShortcut {
  label: string;
  /** Stored combo strings, for formatCombo; two when both work. */
  combos: string[];
}

export interface FixedShortcutGroup {
  title: string;
  items: FixedShortcut[];
}

/** macOS's own Next/Previous Tab keys (Safari, Finder, Terminal), fixed
 *  there alongside the configurable Ctrl+Tab. Matched by physical key: with
 *  Shift held, the character is "}" on a US keyboard and something else on
 *  others (see macTabStep). */
export const MAC_NEXT_TAB = "mod+shift+]";
export const MAC_PREVIOUS_TAB = "mod+shift+[";

/** ⌘⇧] and ⌘⇧[ on a Mac or an iPad keyboard: 1 for the next tab, -1 for the
 *  previous one, null for any other key. */
export function macTabStep(e: KeyboardEvent, mac: boolean): 1 | -1 | null {
  if (!mac || !e.metaKey || !e.shiftKey || e.altKey || e.ctrlKey) return null;
  if (e.code === "BracketRight") return 1;
  if (e.code === "BracketLeft") return -1;
  return null;
}

/** Every configurable shortcut unbound: what is left in the menu is fixed. */
function unbound(): Shortcuts {
  const shortcuts = defaultShortcuts();
  for (const key of Object.keys(shortcuts) as (keyof Shortcuts)[])
    shortcuts[key] = "";
  return shortcuts;
}

function withCombos(nodes: MenuNode[], into: FixedShortcut[]) {
  for (const node of nodes) {
    if (node === "separator") continue;
    if (node.accel) into.push({ label: node.label, combos: [node.accel] });
    if (node.submenu) withCombos(node.submenu, into);
  }
}

export function fixedShortcutGroups(
  t: Strings,
  platform: ShortcutPlatform,
): FixedShortcutGroup[] {
  const mac = platform === "macos" || platform === "ios";
  const groups: FixedShortcutGroup[] = [];
  // The menu's root items (Settings, Exit) go with File, as on macOS.
  const root: FixedShortcut[] = [];
  for (const node of buildAppMenu(t, unbound(), NO_RECENTS)) {
    if (node === "separator") continue;
    if (!node.submenu) {
      withCombos([node], root);
      continue;
    }
    const items: FixedShortcut[] = [];
    withCombos(node.submenu, items);
    if (items.length > 0) groups.push({ title: node.label, items });
  }
  groups[0].items.push(...root);

  const find = (label: string) =>
    groups.flatMap((group) => group.items).find((item) => item.label === label);
  const exit = find(t.menuExit);
  if (exit && mac) {
    // Cmd+Q, as menu.rs binds it; Alt+F4 is Windows'.
    exit.label = t.menuQuit.replace("{name}", APP_NAME);
    exit.combos = ["mod+q"];
  } else if (exit && platform === "linux") {
    // useGlobalShortcuts routes Ctrl+Q to Quit there as well.
    exit.combos.push("mod+q");
  }
  const redo = find(t.menuRedo);
  // Milkdown's history binds both; a Mac advertises Cmd+Shift+Z.
  if (redo) redo.combos = mac ? ["mod+shift+z"] : ["mod+y", "mod+shift+z"];

  const view = groups.find((group) => group.title === t.menuView);
  if (view && mac) {
    // F11 is the app's own handler where it draws the frame; on a Mac the
    // native View menu names its fullscreen key itself.
    view.items = view.items.filter((item) => !item.combos.includes("f11"));
    view.items.push(
      { label: t.shortcutNextTab, combos: [MAC_NEXT_TAB] },
      { label: t.shortcutPreviousTab, combos: [MAC_PREVIOUS_TAB] },
    );
  }

  groups.push({
    title: t.menuFormat,
    items: [
      { label: t.toolbarBold, combos: ["mod+b"] },
      { label: t.toolbarItalic, combos: ["mod+i"] },
      // editor/keys/block-keys-plugin.ts.
      { label: t.shortcutLeaveBlock, combos: ["mod+enter"] },
    ],
  });
  return groups;
}
