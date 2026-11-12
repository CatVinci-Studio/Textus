import type { Settings } from "../prefs/SettingsContext";

/** The chat model the user chose for the provider in use, or null for the
 *  provider's default, which the backend picks (the first the picker lists). */
export function chosenModel(
  settings: Pick<Settings, "aiProvider" | "agentModels">,
): string | null {
  return settings.agentModels[settings.aiProvider] || null;
}
