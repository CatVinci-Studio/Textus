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
