import { APP_NAME, type Strings } from "../i18n/strings";
import { defaultShortcuts, type Shortcuts } from "../prefs/SettingsContext";
import { buildAppMenu, NO_RECENTS, type MenuNode } from "./menu/app-menu-model";

/**
 * The shortcuts that can't be changed, for Settings › Shortcuts. Read off
 * the app menu model with every configurable shortcut unbound, plus the
 * platform differences and fixed keys no menu item carries.
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

/** macOS's own Next/Previous Tab keys, matched by physical key: the shifted
 *  character differs between keyboard layouts. */
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
    // Cmd+Q on a Mac; Alt+F4 is Windows'.
    exit.label = t.menuQuit.replace("{name}", APP_NAME);
    exit.combos = ["mod+q"];
  } else if (exit && platform === "linux") {
    // Ctrl+Q also quits on Linux.
    exit.combos.push("mod+q");
  }
  const redo = find(t.menuRedo);
  // The history keymap binds both; a Mac advertises Cmd+Shift+Z.
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
      { label: t.shortcutLeaveBlock, combos: ["mod+enter"] },
      { label: t.shortcutMoveBlockUp, combos: ["alt+arrowup"] },
      { label: t.shortcutMoveBlockDown, combos: ["alt+arrowdown"] },
    ],
  });
  // The keyboard's way round the window and through Textus AI's changes.
  groups.push({
    title: t.shortcutKeyboardGroupLabel,
    items: [
      // Ctrl+- on a Mac, where Cmd+[ outdents a list item (useNavHistory.ts).
      {
        label: t.shortcutNavBack,
        combos: [mac ? "ctrl+-" : "alt+arrowleft"],
      },
      {
        label: t.shortcutNavForward,
        combos: [mac ? "ctrl+shift+-" : "alt+arrowright"],
      },
      { label: t.shortcutCycleRegions, combos: ["f6", "shift+f6"] },
      { label: t.quickAskNextEdit, combos: ["f7"] },
      { label: t.quickAskPrevEdit, combos: ["shift+f7"] },
      // Per sentence, once ‹ › or F7 point at one.
      { label: t.shortcutTakeChange, combos: ["mod+enter"] },
      { label: t.shortcutKeepOriginal, combos: ["mod+backspace"] },
    ],
  });
  return groups;
}
