import { fill } from "../../i18n/fill";
import { showConfirm } from "../../engine/controls/app-dialog";
import { changeSettings, loadSettings } from "../../prefs/settings-store";
import { canUseWindows } from "../../platform/capabilities";
import { pluginName, pluginText, pluginsSnapshot } from "./plugin-records";
import type { Settings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import type {
  PluginManifest,
  RequiredSetting,
  Requirement,
} from "./manifest-types";

/**
 * The Textus settings a plugin may say it needs: what each is called in
 * Settings, whether this system has it, whether it is on, and how to turn
 * it on.
 */
const SETTINGS: Record<
  RequiredSetting,
  {
    label: (t: Strings) => string;
    /** Whether the setting exists here; where it doesn't, the plugin runs
     *  without it and nobody is asked. */
    here: () => boolean;
    on: (s: Settings) => boolean;
    turnOn: () => Partial<Settings>;
  }
> = {
  runInBackground: {
    label: (t) => t.backgroundToggle,
    // Windows to close and a tray to stay in: the desktop's.
    here: () => canUseWindows,
    on: (s) => s.runInBackground,
    turnOn: () => ({ runInBackground: true }),
  },
};

/** What `manifest` requires that this system has: the ones to show and
 *  ask for. */
export function requirementsHere(
  manifest: Pick<PluginManifest, "requires">,
): Requirement[] {
  return manifest.requires.filter((r) => SETTINGS[r.setting].here());
}

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
  // Its own switch, not "all plugins": what it asks for are Textus's settings.
  if (!record?.manifest || record.status !== "on") return;
  for (const need of requirementsHere(record.manifest)) {
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
