import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { type ContentWidth, type Settings } from "../../prefs/SettingsContext";
import { classicLookChange, isClassicLook } from "../../prefs/classic-look";
import { SettingRow, ToggleRow } from "../sections/controls";
import { DocTextFold } from "../sections/text-font";
import { InterfaceSizeRow } from "../sections/interface-size";
import { ThemeSection, ThemesTab } from "../sections/theme";
import { Select } from "../../engine/controls/Select";
import { appDrawsWindowFrame } from "../../platform/window-chrome";
import { canUseWindows, isMobileApp } from "../../platform/capabilities";
import { useFileIconThemes } from "../../plugins/contributions/file-icon-themes";

/** Appearance › Basics: light or dark, the editor's theme and importing
 *  one, the interface's size, file icons; then the window's layout, its rail, title row
 *  and menu bar, and a button back to the look from before 1.4; one's own CSS
 *  under Advanced. */

export function AppearancePage({
  t,
  settings,
  setSettings,
}: SettingsPageProps) {
  return (
    <>
      <SettingsGroup title={t.navAppearance}>
        <ThemeSection t={t} />
        <InterfaceSizeRow t={t} settings={settings} setSettings={setSettings} />
        <FileIconThemeRow t={t} settings={settings} setSettings={setSettings} />
      </SettingsGroup>
      {/* How a document's text is set: its own, whatever the theme. */}
      <SettingsGroup title={t.appearanceTextGroup}>
        <DocTextFold t={t} settings={settings} setSettings={setSettings} />
        <SettingRow label={t.contentWidthLabel}>
          <Select
            className="settings-select"
            aria-label={t.contentWidthLabel}
            value={settings.contentWidth}
            onChange={(e) =>
              setSettings({ contentWidth: e.target.value as ContentWidth })
            }
          >
            <option value="auto">{t.contentWidthAuto}</option>
            <option value="standard">{t.contentWidthStandard}</option>
            <option value="full">{t.contentWidthFull}</option>
          </Select>
        </SettingRow>
        <ToggleRow
          label={t.firstLineIndentLabel}
          checked={settings.firstLineIndent}
          onChange={(v) => setSettings({ firstLineIndent: v })}
        />
        {!isMobileApp && (
          <ToggleRow
            label={t.smoothCaretLabel}
            checked={settings.smoothCaret}
            onChange={(v) => setSettings({ smoothCaret: v })}
          />
        )}
      </SettingsGroup>
      <SettingsGroup title={t.windowLayoutGroup}>
        <SettingRow label={t.layoutLabel}>
          <Select
            className="settings-select"
            aria-label={t.layoutLabel}
            value={settings.layout}
            onChange={(e) =>
              setSettings({ layout: e.target.value as Settings["layout"] })
            }
          >
            <option value="islands">{t.layoutIslands}</option>
            <option value="classic">{t.layoutClassic}</option>
          </Select>
        </SettingRow>
        <ToggleRow
          label={t.activityRailLabel}
          checked={settings.activityRail}
          onChange={(on) => setSettings({ activityRail: on })}
        />
        {canUseWindows && (
          <ToggleRow
            label={t.titleRowLabel}
            checked={settings.titleRowShown}
            onChange={(on) => setSettings({ titleRowShown: on })}
          />
        )}
        {appDrawsWindowFrame && (
          <ToggleRow
            label={t.menuBarLabel}
            checked={settings.menuBarShown}
            onChange={(on) => setSettings({ menuBarShown: on })}
          />
        )}
        <ToggleRow
          label={t.plainFrameLabel}
          checked={settings.plainFrame}
          onChange={(on) => setSettings({ plainFrame: on })}
        />
        {canUseWindows && (
          <ToggleRow
            label={t.classicLookLabel}
            checked={isClassicLook(settings)}
            onChange={(on) => setSettings(classicLookChange(on, settings))}
          />
        )}
      </SettingsGroup>
    </>
  );
}

/** The file icon themes plugins give. One whose plugin is off shows as
 *  Default, but stays chosen for when it is back. */
function FileIconThemeRow({
  t,
  settings,
  setSettings,
}: Pick<SettingsPageProps, "t" | "settings" | "setSettings">) {
  const themes = useFileIconThemes();
  const chosen = themes.some((x) => x.id === settings.fileIconTheme)
    ? settings.fileIconTheme
    : "";
  return (
    <SettingRow label={t.fileIconThemeLabel}>
      <Select
        className="settings-select"
        aria-label={t.fileIconThemeLabel}
        value={chosen}
        onChange={(e) => setSettings({ fileIconTheme: e.target.value })}
      >
        <option value="">{t.fileIconThemeDefault}</option>
        {themes.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </Select>
    </SettingRow>
  );
}

/** Appearance › Theme store: the themes installed, then the gallery's. */
export function ThemeStorePage({ t }: SettingsPageProps) {
  return <ThemesTab t={t} />;
}
