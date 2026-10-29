import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { type NewDocumentMode } from "../../prefs/SettingsContext";
import { LANGS, LANG_NAMES, type Lang } from "../../i18n/strings";
import { LinkRow, SettingRow, ToggleRow } from "../sections/controls";
import { CliCommandSection, DefaultEditorSection } from "../sections/general";
import { BackgroundSection } from "../sections/background";
import { Select } from "../../ui/Select";
import {
  canInstallCliCommand,
  canSetDefaultEditor,
  canUseWindows,
  isDesktopApp,
} from "../../platform/capabilities";
import { emitMenuEvent } from "../../platform/menu-events";
import { links } from "../../platform/ipc";

/** General: language, documents and disk, system integrations, About, and
 *  the guides. */
export function GeneralPage({
  t,
  settings,
  setSettings,
  setSubpage,
  openHelp,
  onClose,
}: SettingsPageProps) {
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
            <SettingRow label={t.newDocumentModeLabel}>
              <Select
                className="settings-select"
                aria-label={t.newDocumentModeLabel}
                value={settings.newDocumentMode}
                onChange={(e) =>
                  setSettings({
                    newDocumentMode: e.target.value as NewDocumentMode,
                  })
                }
              >
                <option value="window">{t.newDocumentModeWindow}</option>
                <option value="tab">{t.newDocumentModeTab}</option>
              </Select>
            </SettingRow>
            <ToggleRow
              label={t.restoreSessionLabel}
              checked={settings.restoreSessionOnStartup}
              onChange={(v) => setSettings({ restoreSessionOnStartup: v })}
            />
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

      <SettingsGroup title={t.generalSystemLabel}>
        {/* A desktop's: the phone has no windows to close. */}
        {canUseWindows && <BackgroundSection t={t} />}
        {canSetDefaultEditor && <DefaultEditorSection t={t} />}
        {canInstallCliCommand && <CliCommandSection t={t} />}
      </SettingsGroup>

      {/* Last: links out rather than settings. A phone's menu is kept short,
            so there this is where they are. */}
      <SettingsGroup title={t.settingsHelpGroup}>
        {isDesktopApp && (
          <LinkRow
            label={t.menuHelpWelcome}
            onOpen={() => openHelp("welcome")}
          />
        )}
        <LinkRow label={t.navGuides} onOpen={() => setSubpage("guides")} />
        {/* The dialog is the window's, behind this panel. */}
        {isDesktopApp && (
          <LinkRow
            label={t.menuHelpReport}
            onOpen={() => {
              onClose();
              emitMenuEvent("help-report");
            }}
          />
        )}
        <LinkRow
          label={t.menuHelpCommunity}
          onOpen={() => void links.openCommunityPage(settings.language)}
        />
        <LinkRow label={t.aboutTextus} onOpen={() => setSubpage("about")} />
      </SettingsGroup>
    </>
  );
}
