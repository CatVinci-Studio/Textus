import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { LANGS, LANG_NAMES, type Lang } from "../../i18n/strings";
import { SettingRow, ToggleRow } from "../sections/controls";
import { CliCommandSection, DefaultEditorSection } from "../sections/general";
import { BackgroundSection } from "../sections/background";
import { Select } from "../../engine/controls/Select";
import {
  canInstallCliCommand,
  canSetDefaultEditor,
  canUseWindows,
} from "../../platform/capabilities";

/** General: language, documents and disk, system integrations, and which
 *  updates to take. */
export function GeneralPage({ t, settings, setSettings }: SettingsPageProps) {
  return (
    <>
      <SettingsGroup title={t.generalBasicsLabel}>
        <SettingRow label={t.languageLabel}>
          <Select
            className="settings-select"
            aria-label={t.languageLabel}
            value={settings.language}
            onChange={(e) => setSettings({ language: e.target.value as Lang })}
          >
            {/* Each in its own language, so a user who can't read the
                  current one still finds theirs. */}
            {LANGS.map((lang) => (
              <option key={lang} value={lang}>
                {LANG_NAMES[lang]}
              </option>
            ))}
          </Select>
        </SettingRow>
        {canUseWindows && (
          <>
            <SettingRow label={t.startupOpenLabel}>
              <Select
                className="settings-select"
                aria-label={t.startupOpenLabel}
                value={
                  settings.restoreSessionOnStartup
                    ? "session"
                    : settings.startPageOnLaunch
                      ? "start"
                      : "blank"
                }
                onChange={(e) =>
                  setSettings({
                    restoreSessionOnStartup: e.target.value === "session",
                    startPageOnLaunch: e.target.value === "start",
                  })
                }
              >
                <option value="session">{t.startupOpenSession}</option>
                <option value="start">{t.startupOpenStartPage}</option>
                <option value="blank">{t.startupOpenBlank}</option>
              </Select>
            </SettingRow>
            <SettingRow label={t.closeLastLabel}>
              <Select
                className="settings-select"
                aria-label={t.closeLastLabel}
                value={settings.closeLastToStartPage ? "start" : "window"}
                onChange={(e) =>
                  setSettings({
                    closeLastToStartPage: e.target.value === "start",
                  })
                }
              >
                <option value="window">{t.closeLastWindow}</option>
                <option value="start">{t.closeLastStartPage}</option>
              </Select>
            </SettingRow>
          </>
        )}
      </SettingsGroup>

      {/* How documents reach the disk - used daily, so above the rarer
            groups. */}
      <SettingsGroup title={t.settingsFilesGroup}>
        <ToggleRow
          label={t.autosaveLabel}
          checked={settings.autosave}
          onChange={(v) => setSettings({ autosave: v })}
        />
        <ToggleRow
          label={t.autoSuggestFilenameLabel}
          checked={settings.autoSuggestFilename}
          onChange={(v) => setSettings({ autoSuggestFilename: v })}
        />
      </SettingsGroup>

      {/* A desktop's: the phone has no windows to close, no default editor
          and no terminal, so no group either. */}
      {(canUseWindows || canSetDefaultEditor || canInstallCliCommand) && (
        <SettingsGroup title={t.generalSystemLabel}>
          {canUseWindows && <BackgroundSection t={t} />}
          {canSetDefaultEditor && <DefaultEditorSection t={t} />}
          {canInstallCliCommand && <CliCommandSection t={t} />}
        </SettingsGroup>
      )}
    </>
  );
}
