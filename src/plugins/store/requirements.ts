import { fill } from "../../i18n/fill";
import { showConfirm } from "../../engine/controls/app-dialog";
import { changeSettings, loadSettings } from "../../prefs/settings-store";
import {
  pluginMayRun,
  pluginName,
  pluginText,
  pluginsSnapshot,
} from "./plugin-records";
import type { Settings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import type { RequiredSetting, Requirement } from "./manifest";

/**
 * The Textus settings a plugin may say it needs: what each is called in
 * Settings, whether it is on, and how to turn it on.
 */
const SETTINGS: Record<
  RequiredSetting,
  {
    label: (t: Strings) => string;
    on: (s: Settings) => boolean;
    turnOn: () => Partial<Settings>;
  }
> = {
  runInBackground: {
    label: (t) => t.backgroundToggle,
    on: (s) => s.runInBackground,
    turnOn: () => ({ runInBackground: true }),
  },
};

export function requirementLabel(r: Requirement, t: Strings): string {
  return SETTINGS[r.setting].label(t);
}

export function requirementMet(r: Requirement, settings: Settings): boolean {
  return SETTINGS[r.setting].on(settings);
}

export function turnOnRequirement(r: Requirement): Partial<Settings> {
  return SETTINGS[r.setting].turnOn();
}

/** What plugin `id` needs that is off, now that it is on: asked to turn
 *  each on, once, in the plugin's words. Every way of installing or
 *  turning one on ends here. */
export async function askForRequirements(id: string, t: Strings) {
  const record = pluginsSnapshot().records.find((r) => r.id === id);
  if (!record?.manifest || !pluginMayRun(record)) return;
  for (const need of record.manifest.requires) {
    if (requirementMet(need, loadSettings())) continue;
    const ok = await showConfirm(
      fill(t.pluginRequiresAsk, {
        name: pluginName(record),
        setting: requirementLabel(need, t),
        reason: need.reason ? pluginText(record, need.reason) : "",
      }),
      {
        title: pluginName(record),
        okLabel: t.pluginTurnOn,
        cancelLabel: t.pluginRequiresLater,
      },
    );
    if (ok) changeSettings(turnOnRequirement(need));
  }
}
