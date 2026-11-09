import {
  loadProjectPluginSettings,
  pluginValue,
  setPluginValue,
  type SettingScope,
} from "./store/plugin-settings";
import { pluginRecord, pluginsSnapshot, update } from "./store/plugin-records";
import { hosts } from "./running-hosts";

/**
 * A plugin's settings as its code and Settings read and write them: the
 * project's value over the general one over the manifest's default, the
 * running plugin told when one changes.
 */

/** A plugin's setting: the project's value, else the one for every
 *  document, else its manifest's default. */
export function pluginSetting(id: string, key: string): unknown {
  const { value, from } = pluginValue(id, key);
  if (from) return value;
  return (
    pluginRecord(id)?.manifest?.contributes.settings.find((s) => s.key === key)
      ?.default ?? null
  );
}

/** Sets a plugin's setting for every document, or for the open project. */
export async function setPluginSetting(
  id: string,
  key: string,
  value: unknown,
  scope: SettingScope = "global",
): Promise<void> {
  await setPluginValue(id, key, value, scope);
  update(id, {});
  hosts.get(id)?.event("settings", { key, value: pluginSetting(id, key) });
}

/** A project opened or closed: its plugins hear the settings it changes. */
export async function setPluginProject(root: string | null): Promise<void> {
  const before = new Map<string, unknown>();
  const running = pluginsSnapshot().records.filter((r) => hosts.has(r.id));
  for (const r of running)
    for (const s of r.manifest?.contributes.settings ?? [])
      before.set(`${r.id}\u0000${s.key}`, pluginSetting(r.id, s.key));
  await loadProjectPluginSettings(root);
  for (const r of running)
    for (const s of r.manifest?.contributes.settings ?? []) {
      const value = pluginSetting(r.id, s.key);
      if (before.get(`${r.id}\u0000${s.key}`) !== value)
        hosts.get(r.id)?.event("settings", { key: s.key, value });
    }
  for (const r of running) update(r.id, {});
}
