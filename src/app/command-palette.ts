import { currentStrings } from "../i18n/current";
import type { Strings } from "../i18n/strings";
import type { Settings } from "../prefs/SettingsContext";
import { loadSettings } from "../prefs/settings-store";
import { showQuickPick, type QuickPickItem } from "../ui/quick-pick";
import { sendTourSignal } from "../utils/events";
import { commands, commandShortcut, runCommand } from "./commands";
import { runMenuAction } from "./menu/app-menu-actions";
import {
  buildAppMenu,
  NO_RECENTS,
  type MenuAction,
  type MenuNode,
} from "./menu/app-menu-model";

/**
 * The command palette: every menu item and plugin command, found by typing.
 * Read from the menu model and command registry, so nothing is listed twice.
 */
export interface PaletteEntry {
  label: string;
  /** Where else it is: "File", "Format › Heading". */
  where?: string;
  keys?: string;
  run: { menu: MenuAction } | { command: string };
}

/** The menu's items that do something now, each with its path, then the
 *  commands no menu item runs. Recent files and the palette are left out. */
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
function currentEntries(
  t: Strings,
  { shortcuts, commandShortcuts }: Settings,
): PaletteEntry[] {
  return paletteEntries(
    buildAppMenu(t, shortcuts, NO_RECENTS),
    commands()
      .filter((c) => c.palette !== false && c.enabled?.() !== false)
      .map((c) => ({
        id: c.id,
        title: c.title(t),
        shortcut: commandShortcut(c, commandShortcuts) || undefined,
      })),
  );
}

/** Opens the palette; the entry picked runs. */
export async function openCommandPalette(): Promise<void> {
  await pickWithCommands([], "");
}

/**
 * The palette with a plugin's own items first (Vim's Ex commands), for
 * textus.ui.pick's `commands`: one of those resolves its value, an entry of
 * the palette runs and resolves null, and Enter on text that matches nothing
 * resolves { typed: text }.
 */
export async function pickWithCommands(
  own: QuickPickItem[],
  query: string,
  placeholder?: string,
): Promise<unknown> {
  const t = currentStrings();
  const entries = currentEntries(t, loadSettings());
  const items: QuickPickItem[] = [
    ...own.map((item) => ({ ...item, value: { own: item } })),
    ...entries.map((entry, i) => ({
      label: entry.label,
      description: entry.where,
      keys: entry.keys,
      value: { entry: i },
    })),
  ];
  const picked = (await showQuickPick(
    items,
    placeholder ?? t.commandPalettePlaceholder,
    { query, typed: own.length > 0 || query !== "" },
  )) as { own: QuickPickItem } | { entry: number } | { typed: string } | null;
  if (!picked) return null;
  if ("typed" in picked) return picked;
  if ("own" in picked)
    return picked.own.value === undefined ? picked.own.label : picked.own.value;
  const { run } = entries[picked.entry];
  if ("command" in run) runCommand(run.command);
  else runMenuAction(run.menu);
  sendTourSignal("palette-command");
  return null;
}
