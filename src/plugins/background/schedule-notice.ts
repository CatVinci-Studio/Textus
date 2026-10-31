import type { Settings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { showNotice } from "../../ui/notices";
import { getUiState, setUiState } from "../../storage/ui-state";
import type { Requirement } from "../store/manifest";
import { pluginName, pluginRecord, windowInfo } from "../store/plugin-records";
import {
  requirementLabel,
  requirementMet,
  turnOnRequirement,
} from "../store/requirements";

const BACKGROUND: Requirement = { setting: "runInBackground" };
/** Told in this window, should ui-state not be kept (no settings file). */
const toldNow = new Set<string>();

export type SettingsAccess = () => {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
};
/** The window's settings, while it is connected (schedule-window.ts). */
let windowSettings: SettingsAccess | null = null;
/** Plugins that scheduled before the window's settings were connected. */
const waiting = new Set<string>();

export function setNoticeSettings(access: SettingsAccess): void {
  windowSettings = access;
  for (const id of waiting) pluginScheduled(id);
  waiting.clear();
}

/** Lets go of `access`, unless a later connection has replaced it: a
 *  window's connections can end after the next one has begun. */
export function clearNoticeSettings(access: SettingsAccess): void {
  if (windowSettings === access) windowSettings = null;
}

/** A plugin scheduled a job, from its code or its background code. */
export function pluginScheduled(id: string): void {
  const record = pluginRecord(id);
  const access = windowSettings?.();
  if (!access) waiting.add(id);
  else if (record)
    tellOfScheduling(
      id,
      pluginName(record),
      windowInfo().strings(),
      access.settings,
      access.setSettings,
    );
}

/** With background mode off, the first time a plugin schedules a job a
 *  notice says its jobs fire only while Textus runs, with a button that
 *  turns background mode on. */
function tellOfScheduling(
  plugin: string,
  name: string,
  t: Strings,
  settings: Settings,
  setSettings: (patch: Partial<Settings>) => void,
): void {
  if (requirementMet(BACKGROUND, settings)) return;
  const told = getUiState("pluginsToldOfSchedule");
  const list = Array.isArray(told) ? (told as string[]) : [];
  if (list.includes(plugin) || toldNow.has(plugin)) return;
  toldNow.add(plugin);
  setUiState("pluginsToldOfSchedule", [...list, plugin]);
  showNotice(
    t.pluginScheduleNotice
      .replace("{name}", name)
      .replace("{setting}", requirementLabel(BACKGROUND, t)),
    {
      source: name,
      action: {
        label: t.pluginRequiresTurnOn,
        run: () => setSettings(turnOnRequirement(BACKGROUND)),
      },
    },
  );
}
