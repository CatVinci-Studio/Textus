import { currentStrings } from "../i18n/current";
import type { Strings } from "../i18n/strings";
import type { Shortcuts } from "../settings/SettingsContext";
import { loadSettings } from "../settings/settings-store";
import { showQuickPick, type QuickPickItem } from "../ui/quick-pick";
import { commands, runCommand } from "./commands";
import { runMenuAction } from "./menu/app-menu-actions";
import {
  buildAppMenu,
  NO_RECENTS,
  type MenuAction,
  type MenuNode,
} from "./menu/app-menu-model";

/**
 * View › Command Palette (mod+shift+p): everything the menus do and every
 * command a plugin adds, in one list found by typing - VS Code's and
 * Obsidian's palette. It reads the menu the app already builds
 * (app-menu-model.ts) and the command registry (commands.ts), so nothing
 * is listed twice over and a new menu item is in it by itself.
 */
export interface PaletteEntry {
  label: string;
  /** Where else it is: "File", "Format › Heading". */
  where?: string;
  keys?: string;
  run: { menu: MenuAction } | { command: string };
}

/** The menu's items that do something now, each with the path to it,
 *  then the registered commands no menu item already runs. Recent files
 *  are left out (File › Open Recent lists them), and so is the palette. */
export function paletteEntries(
  menu: MenuNode[],
  registered: readonly { id: string; title: string; shortcut?: string }[],
): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  const walk = (nodes: MenuNode[], path: string[]) => {
    for (const node of nodes) {
      if (node === "separator" || node.disabled) continue;
      if (node.submenu) walk(node.submenu, [...path, node.label]);
      else if (node.action && !skipped(node.action))
        out.push({
          label: node.label,
          where: path.join(" › ") || undefined,
          keys: node.accel,
          run: { menu: node.action },
        });
    }
  };
  walk(menu, []);
  const inMenu = new Set(
    out.flatMap(({ run }) =>
      "menu" in run && "native" in run.menu
        ? [run.menu.native.replace(/^plugin-command:/, "")]
        : [],
    ),
  );
  for (const c of registered)
    if (!inMenu.has(c.id))
      out.push({ label: c.title, keys: c.shortcut, run: { command: c.id } });
  return out;
}

/** A recent file or folder, or the palette itself. */
function skipped(action: MenuAction): boolean {
  return (
    "native" in action &&
    (/^recent(-folder)?:/.test(action.native) ||
      action.native === "command-palette")
  );
}

/** The palette's entries as the app is now. */
function currentEntries(t: Strings, shortcuts: Shortcuts): PaletteEntry[] {
  return paletteEntries(
    buildAppMenu(t, shortcuts, NO_RECENTS),
    commands()
      .filter((c) => c.enabled?.() !== false)
      .map((c) => ({ id: c.id, title: c.title(t), shortcut: c.shortcut })),
  );
}

/** Opens the palette; the entry picked runs. */
export async function openCommandPalette(): Promise<void> {
  const t = currentStrings();
  const entries = currentEntries(t, loadSettings().shortcuts);
  const items: QuickPickItem[] = entries.map((entry, i) => ({
    label: entry.label,
    description: entry.where,
    keys: entry.keys,
    value: i,
  }));
  const picked = await showQuickPick(items, t.commandPalettePlaceholder);
  if (typeof picked !== "number") return;
  const { run } = entries[picked];
  if ("command" in run) runCommand(run.command);
  else runMenuAction(run.menu);
}
