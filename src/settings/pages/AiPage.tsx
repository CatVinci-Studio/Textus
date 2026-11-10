import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { ToggleRow } from "../sections/controls";

/** Textus AI: its one switch. Off, nothing reaches a provider and its
 *  three pages (Providers, Chat & Writing, Skills & Memory) say so. */
export function AiPage({ t, settings, setSettings }: SettingsPageProps) {
  return (
    <SettingsGroup>
      <ToggleRow
        label={t.textusAiToggleLabel}
        hint={settings.textusAi ? undefined : t.textusAiOffHint}
        checked={settings.textusAi}
        onChange={(v) => setSettings({ textusAi: v })}
      />
    </SettingsGroup>
  );
}
