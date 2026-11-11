import type { MenuEntry } from "./app-menu-model";
import { compareNames } from "../../utils/name-order";

/** A Plugins menu item that opens a plugin's settings, not a command:
 *  "plugin-settings:<plugin id>". */
export const PLUGIN_SETTINGS = "plugin-settings:";

/** A command a plugin put in the Plugins menu. */
export interface PluginMenuEntry {
  command: string;
  label: string;
  /** The plugin's name: two or more of its commands go in a submenu of it. */
  group?: string;
}

/** Plugin commands as menu entries: a plugin with several in a submenu
 *  named for it, one with a single command as it is, by plugin name. */
export function pluginMenuNodes(
  plugins: readonly PluginMenuEntry[],
): MenuEntry[] {
  const groups = new Map<string, PluginMenuEntry[]>();
  for (const p of plugins) {
    const key = p.group ?? p.label;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const entry = (p: PluginMenuEntry): MenuEntry => ({
    label: p.label,
    action: { native: `plugin-command:${p.command}` },
  });
  return [...groups.entries()]
    .sort(([a], [b]) => compareNames(a, b))
    .map(([name, items]) =>
      items.length > 1
        ? { label: name, submenu: items.map(entry) }
        : entry(items[0]),
    );
}
