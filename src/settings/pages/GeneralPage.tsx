import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { LANGS, LANG_NAMES, type Lang } from "../../i18n/strings";
import { AdvancedFold, SettingRow, ToggleRow } from "../sections/controls";
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

/** General: language, what opens and closes, documents and disk, the
 *  system's integrations, then the network proxy and the file tree's two
 *  confirmations folded at the end. */
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
          groups. The two draft switches are here, not under Privacy: they
          decide what survives a crash or a close. */}
      <SettingsGroup title={t.settingsFilesGroup}>
        <ToggleRow
          label={t.autosaveLabel}
          checked={settings.autosave}
          onChange={(v) => setSettings({ autosave: v })}
        />
        <ToggleRow
          label={t.privacyDraftRecoveryToggle}
          checked={settings.enableDraftRecovery}
          onChange={(v) => setSettings({ enableDraftRecovery: v })}
        />
        {/* Kept as drafts: only while drafts are kept at all. */}
        {settings.enableDraftRecovery && (
          <ToggleRow
            label={t.privacyKeepUnsavedToggle}
            help={t.privacyKeepUnsavedHelp}
            checked={settings.keepUnsavedOnClose}
            onChange={(v) => setSettings({ keepUnsavedOnClose: v })}
          />
        )}
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
      </SettingsGroup>

      {/* A desktop's own: the phone has no windows to close, no default
          editor and no terminal. */}
      {(canUseWindows || canSetDefaultEditor || canInstallCliCommand) && (
        <SettingsGroup title={t.generalSystemLabel}>
          {canSetDefaultEditor && <DefaultEditorSection t={t} />}
          {canUseWindows && <BackgroundSection t={t} />}
          {canInstallCliCommand && <CliCommandSection t={t} />}
        </SettingsGroup>
      )}

      {/* Rarely changed, and for those who know their network: one fold,
          one level deep. */}
      <AdvancedFold t={t}>
        <ProxySection t={t} settings={settings} setSettings={setSettings} />
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
      </AdvancedFold>
    </>
  );
}
