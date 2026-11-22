import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  UI_TEXT_SCALES,
  type ContentWidth,
  type UiTextScale,
  type Settings,
} from "../../prefs/SettingsContext";
import { classicLookChange, isClassicLook } from "../../prefs/classic-look";
import { SettingRow, ToggleRow } from "../sections/controls";
import { DocTextFold } from "../sections/text-font";
import { ThemeSection, ThemesTab } from "../sections/theme";
import { Select } from "../../engine/controls/Select";
import { appDrawsWindowFrame } from "../../platform/window-chrome";
import { canUseWindows, isMobileApp } from "../../platform/capabilities";

/** Appearance › Basics: light or dark, the editor's theme and importing
 *  one, the interface's size; then the window's layout, its rail, title row
 *  and menu bar, and a button back to the look from before 1.4; one's own CSS
 *  under Advanced. */
const SIZE_NAMES = {
  0.85: "uiTextSmall",
  1: "uiTextMedium",
  1.25: "uiTextLarge",
} as const satisfies Record<UiTextScale, string>;

export function AppearancePage({
  t,
  settings,
  setSettings,
}: SettingsPageProps) {
  return (
    <>
      <SettingsGroup title={t.navAppearance}>
        <ThemeSection t={t} />
        <SettingRow label={t.uiTextScaleLabel}>
          <Select
            className="settings-select"
            aria-label={t.uiTextScaleLabel}
            value={String(settings.uiTextScale)}
            onChange={(e) =>
              setSettings({
                uiTextScale: Number(e.target.value) as UiTextScale,
              })
            }
          >
            {UI_TEXT_SCALES.map((scale) => (
              <option key={scale} value={String(scale)}>
                {t[SIZE_NAMES[scale]]}
              </option>
            ))}
          </Select>
        </SettingRow>
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

/** Appearance › Theme store: the themes installed, then the gallery's. */
export function ThemeStorePage({ t }: SettingsPageProps) {
  return <ThemesTab t={t} />;
}
