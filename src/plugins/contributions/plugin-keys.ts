import { APP_NAME } from "../../i18n/strings";
import { commandShortcut, commands } from "../../app/commands";
import { fixedShortcutGroups } from "../../app/fixed-shortcuts";
import { keyOwner } from "../../prefs/key-owner";
import { defaultShortcuts } from "../../prefs/SettingsContext";
import { platformName } from "../../platform/window-chrome";
import { modIsMeta } from "../../platform/os";
import { formatCombo, isReservedCombo } from "../../utils/shortcuts";
import { getUiState, setUiState } from "../../storage/ui-state";
import { showNotice } from "../../ui/notices";
import { logPluginMessage } from "../store/plugin-log";
import { windowInfo } from "../store/plugin-records";

/** Told this session, where the UI state isn't kept (a browser). */
const told = new Set<string>();

/** A plugin command's key from its manifest, unless the app, the editor, the
 *  system or a plugin turned on earlier has it: then the command is left
 *  without a key, and the user told once per plugin and key. A key the user
 *  set in Settings is theirs and always kept. */
export function pluginKey(
  plugin: { id: string; name: string },
  command: { id: string; title: string },
  key: string | undefined,
): string | undefined {
  if (!key) return undefined;
  const info = windowInfo();
  const { shortcuts, overrides } = info.keys?.() ?? {
    shortcuts: defaultShortcuts(),
    overrides: {},
  };
  if (command.id in overrides) return key;
  const t = info.strings();
  const owner =
    keyOwner(key, {
      t,
      fixed: fixedShortcutGroups(t, platformName()),
      shortcuts,
      mac: modIsMeta(),
      others: commands().map((c) => ({
        label: c.title(t),
        combo: commandShortcut(c, overrides) ?? "",
      })),
    }) ?? (isReservedCombo(key) ? APP_NAME : undefined);
  if (!owner) return key;
  logPluginMessage(plugin.id, "warn", `${key} is ${owner}'s: not bound.`);
  const pair = `${plugin.id} ${key}`;
  const saved = getUiState("pluginKeysTold");
  const list = Array.isArray(saved) ? (saved as string[]) : [];
  if (!told.has(pair) && !list.includes(pair)) {
    told.add(pair);
    setUiState("pluginKeysTold", [...list, pair]);
    showNotice(
      t.pluginKeyTaken
        .replace("{name}", plugin.name)
        .replace("{key}", formatCombo(key))
        .replace("{owner}", owner)
        .replace("{command}", command.title),
      { tone: "warning" },
    );
  }
  return undefined;
}
