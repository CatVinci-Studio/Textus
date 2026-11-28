import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { LANGS, LANG_NAMES, type Lang } from "../../i18n/strings";
import { SettingRow, ToggleRow } from "../sections/controls";
import { CliCommandSection, DefaultEditorSection } from "../sections/general";
import { BackgroundSection } from "../sections/background";
import { ProxySection } from "../sections/proxy";
import { Select } from "../../engine/controls/Select";
import {
  canDropFilesIntoTree,
  canTrashFiles,
  canInstallCliCommand,
  canSetDefaultEditor,
  canUseWindows,
} from "../../platform/capabilities";

/** General: language, what opens, documents and disk, then the app: its
 *  proxy and system integrations. */
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
      </SettingsGroup>

      {/* What opens: at launch, after the last document, from the tab
          row's +. */}
      {canUseWindows && (
        <SettingsGroup title={t.generalOpenCloseLabel}>
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
          <SettingRow label={t.addTabLabel}>
            <Select
              className="settings-select"
              aria-label={t.addTabLabel}
              value={settings.addTabShowsStartPage ? "start" : "blank"}
              onChange={(e) =>
                setSettings({
                  addTabShowsStartPage: e.target.value === "start",
                })
              }
            >
              <option value="blank">{t.startupOpenBlank}</option>
              <option value="start">{t.startupOpenStartPage}</option>
            </Select>
          </SettingRow>
        </SettingsGroup>
      )}

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
        <ToggleRow
          label={t.showHiddenFilesLabel}
          hint={t.showHiddenFilesHint}
          checked={settings.showHiddenFiles}
          onChange={(v) => setSettings({ showHiddenFiles: v })}
        />
        {canDropFilesIntoTree && (
          <ToggleRow
            label={t.confirmTreeCopyLabel}
            checked={settings.confirmTreeCopy}
            onChange={(v) => setSettings({ confirmTreeCopy: v })}
          />
        )}
        {canTrashFiles && (
          <ToggleRow
            label={t.confirmTreeTrashLabel}
            checked={settings.confirmTreeTrash}
            onChange={(v) => setSettings({ confirmTreeTrash: v })}
          />
        )}
      </SettingsGroup>

      {/* The proxy, then a desktop's own: the phone has no windows to
          close, no default editor and no terminal. */}
      <SettingsGroup title={t.generalSystemLabel}>
        <ProxySection t={t} settings={settings} setSettings={setSettings} />
        {canUseWindows && <BackgroundSection t={t} />}
        {canSetDefaultEditor && <DefaultEditorSection t={t} />}
        {canInstallCliCommand && <CliCommandSection t={t} />}
      </SettingsGroup>
    </>
  );
}
