import type { StatusItem } from "./status-items";

/** One plugin's part of the status area: its items, and the commands it
 *  puts in the Plugins menu. */
export interface StatusGroup {
  plugin: string;
  items: StatusItem[];
  commands: { command: string; label: string }[];
}

/**
 * The status items by plugin, each where its first item came, with that
 * plugin's own commands (`<plugin>.…`) from `menu` - so a plugin with
 * several things in the bar takes one place there, not one per thing.
 */
export function groupStatusItems(
  all: readonly StatusItem[],
  menu: readonly { command: string; label: string }[],
): StatusGroup[] {
  const groups = new Map<string, StatusGroup>();
  for (const item of all) {
    let group = groups.get(item.plugin);
    if (!group) {
      const own = `${item.plugin}.`;
      group = {
        plugin: item.plugin,
        items: [],
        commands: menu.filter((m) => m.command.startsWith(own)),
      };
      groups.set(item.plugin, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
